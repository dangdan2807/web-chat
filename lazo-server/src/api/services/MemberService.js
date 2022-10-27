const MyError = require('../exception/MyError');

const Member = require('../models/Member');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const memberValidate = require('../validate/memberValidate');
const messageService = require('../services/MessageService');

const GROUP_LEAVE_MESSAGE = 'Đã rời khỏi nhóm';
const MEMBER_ADD_MESSAGE = 'Đã thêm vào nhóm';
const MEMBER_DELETE_MESSAGE = 'Đã xóa ra khỏi nhóm';
const JOIN_FROM_LINK = 'Tham gia từ link';
const ADD_MANAGERS = 'ADD_MANAGERS';

class MemberService {
    getList = async (conversationId, userId) => {
        await Member.getByConversationIdAndUserId(conversationId, userId);

        const users = await Member.getListInfosByConversationId(conversationId);
        return users;
    };

    // rời nhóm
    leaveGroup = async (conversationId, userId) => {
        await memberValidate.validateLeaveGroup(conversationId, userId);

        await Conversation.updateOne(
            { _id: conversationId },
            { $pull: { members: userId, managerIds: userId } },
        );
        await Member.deleteOne({ conversationId, userId });

        // lưu message rời nhóm
        const newMessage = new Message({
            userId,
            content: GROUP_LEAVE_MESSAGE,
            type: 'NOTIFY',
            conversationId,
        });
        const { _id } = await newMessage.save();

        Conversation.updateOne({ _id: conversationId }, { lastMessageId: _id }).then();

        return await messageService.getById(_id, true);
    };

    // thêm thành viên
    addMembers = async (conversationId, userId, newUserIds) => {
        await memberValidate.validateAddMember(conversationId, userId, newUserIds);

        // add member trong conversation
        await Conversation.updateOne({ _id: conversationId }, { $push: { members: newUserIds } });

        newUserIds.forEach((userIdEle) => {
            const member = new Member({
                conversationId,
                userId: userIdEle,
            });
            member.save().then();
        });

        // tin nhắn thêm vào group
        const newMessage = new Message({
            userId,
            manipulatedUserIds: newUserIds,
            content: MEMBER_ADD_MESSAGE,
            type: 'NOTIFY',
            conversationId,
        });

        const { _id, createdAt } = await newMessage.save();

        Conversation.updateOne({ _id: conversationId }, { lastMessageId: _id }).then();

        Member.updateOne({ conversationId, userId }, { lastView: createdAt }).then();

        return await messageService.getById(_id, true);
    };

    // xóa thành viên
    deleteMember = async (conversationId, userId, deleteUserId) => {
        await memberValidate.validateDeleteMember(conversationId, userId, deleteUserId);

        // xóa member trong conversation
        await Conversation.updateOne(
            { _id: conversationId },
            { $pull: { members: deleteUserId, managerIds: deleteUserId } },
        );

        await Member.deleteOne({ conversationId, userId: deleteUserId });

        // tin nhắn thêm vào group
        const newMessage = new Message({
            userId,
            manipulatedUserIds: [deleteUserId],
            content: MEMBER_DELETE_MESSAGE,
            type: 'NOTIFY',
            conversationId,
        });

        const { _id, createdAt } = await newMessage.save();

        Conversation.updateOne({ _id: conversationId }, { lastMessageId: _id }).then();

        Member.updateOne({ conversationId, userId }, { lastView: createdAt }).then();

        return await messageService.getById(_id, true);
    };

    joinConversationFromLink = async (conversationId, myId) => {
        const conversation = await Conversation.getById(conversationId);
        if (!conversation.type || !conversation.isJoinFromLink) {
            throw new MyError('Only group conversation or group not permission join');
        }

        const isExistsInConversation = await Conversation.findOne({
            _id: conversationId,
            members: { $in: [myId] },
        });

        if (isExistsInConversation) {
            throw new MyError('Exists in conversation');
        }

        // add member trong conversation
        await Conversation.updateOne({ _id: conversationId }, { $push: { members: myId } });

        const member = new Member({
            conversationId,
            userId: myId,
        });
        await member.save();

        // tin nhắn thêm vào group
        const newMessage = new Message({
            userId: myId,
            content: JOIN_FROM_LINK,
            type: 'NOTIFY',
            conversationId,
        });

        const { _id, createdAt } = await newMessage.save();

        await Conversation.updateOne({ _id: conversationId }, { lastMessageId: _id });

        await Member.updateOne({ conversationId, userId: myId }, { lastView: createdAt });

        return await messageService.getById(_id, true);
    };

    addManagersForConversation = async (conversationId, newManagerIds, myId) => {
        const conversation = await Conversation.getByIdAndUserId(conversationId, myId);
        const { type, leaderId, managerIds } = conversation;

        if (!type || leaderId + '' !== myId) {
            throw new MyError('Add managers failed, not is leader or only conversation group');
        }
        await Conversation.existsByUserIds(conversationId, newManagerIds);
        let managerIdsTempt = [];
        newManagerIds.forEach((userIdEle) => {
            const index = managerIds.findIndex((ele) => ele + '' == userIdEle);

            if (index === -1 && userIdEle != myId) {
                managerIdsTempt.push(userIdEle);
            }
        });

        if (managerIdsTempt.length === 0) {
            throw new MyError('Add managers failed, not is leader or only conversation group');
        }

        await Conversation.updateOne(
            { _id: conversationId },
            { $set: { managerIds: [...managerIds, ...managerIdsTempt] } },
        );

        // tin nhắn thêm vào group
        const newMessage = new Message({
            userId: myId,
            manipulatedUserIds: managerIdsTempt,
            content: ADD_MANAGERS,
            type: 'NOTIFY',
            conversationId,
        });
        const saveMessage = await newMessage.save();

        const message = await messageService.updateWhenHasNewMessage(
            saveMessage,
            conversationId,
            myId,
        );

        return {
            conversationId,
            managerIds: managerIdsTempt,
            message,
        };
    };
}

module.exports = new MemberService();