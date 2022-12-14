const Message = require('../models/Message');
const Member = require('../models/Member');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const Channel = require('../models/Channel');

const MyError = require('../exception/MyError');
const ArgumentError = require('../exception/ArgumentError');

const awsS3Service = require('../services/AwsS3Service');
const lastViewService = require('../services/LastViewService');

const messageValidate = require('../validate/messageValidate');

const commonUtils = require('../../utils/commonUtils');
const messageUtils = require('../../utils/messageUtils');
const dateUtils = require('../../utils/dateUtils');

class MessageService {
    getList = async (conversationId, userId, page, size) => {
        if (!conversationId || !userId || !size || page < 0 || size <= 0) {
            throw new ArgumentError();
        }

        const conversation = await Conversation.getByIdAndUserId(
            conversationId,
            userId,
        );

        const totalMessages =
            await Message.countDocumentsByConversationIdAndUserId(
                conversationId,
                userId,
            );

        const { skip, limit, totalPages } = commonUtils.getPagination(
            page,
            size,
            totalMessages,
        );

        let messages;

        if (conversation.type) {
            const messagesTempt =
                await Message.getListByConversationIdAndUserIdOfGroup(
                    conversationId,
                    userId,
                    skip,
                    limit,
                );

            messages = messagesTempt.map((messageEle) =>
                messageUtils.convertMessageOfGroup(messageEle),
            );
        } else {
            const messagesTempt =
                await Message.getListByConversationIdAndUserIdOfIndividual(
                    conversationId,
                    userId,
                    skip,
                    limit,
                );
            messages = messagesTempt.map((messageEle) =>
                messageUtils.convertMessageOfIndividual(messageEle),
            );
        }

        await lastViewService.updateLastViewOfConversation(
            conversationId,
            userId,
        );

        return {
            data: messages,
            page,
            size,
            totalPages,
        };
    };

    getListByChannelId = async (channelId, userId, page, size) => {
        if (!channelId || !userId || !size || page < 0 || size <= 0) {
            throw new ArgumentError();
        }

        const channel = await Channel.getById(channelId);
        const { conversationId } = channel;
        await Conversation.getByIdAndUserId(conversationId, userId);

        const totalMessages = await Message.countDocuments({
            channelId,
            deletedUserIds: {
                $nin: [userId],
            },
        });
        const { skip, limit, totalPages } = commonUtils.getPagination(
            page,
            size,
            totalMessages,
        );

        const messagesTempt = await Message.getListByChannelIdAndUserId(
            channelId,
            userId,
            skip,
            limit,
        );
        const messages = messagesTempt.map((messageEle) =>
            messageUtils.convertMessageOfGroup(messageEle),
        );

        await lastViewService.updateLastViewOfChannel(
            conversationId,
            channelId,
            userId,
        );

        return {
            data: messages,
            page,
            size,
            totalPages,
            conversationId,
        };
    };

    getById = async (_id, type) => {
        if (type) {
            const message = await Message.getByIdOfGroup(_id);

            return messageUtils.convertMessageOfGroup(message);
        }

        const message = await Message.getByIdOfIndividual(_id);
        return messageUtils.convertMessageOfIndividual(message);
    };

    // send text
    addText = async (message, userId) => {
        // validate
        await messageValidate.validateTextMessage(message, userId);

        const { channelId, conversationId } = message;
        if (channelId) {
            delete message.conversationId;
        }

        const newMessage = new Message({
            userId,
            ...message,
        });

        // l??u xu???ng
        const saveMessage = await newMessage.save();

        return this.updateWhenHasNewMessage(
            saveMessage,
            conversationId,
            userId,
        );
    };

    // send file
    addFile = async (file, type, conversationId, channelId, userId) => {
        await messageValidate.validateFileMessage(
            file,
            type,
            conversationId,
            channelId,
            userId,
        );

        // upload ???nh
        const content = await awsS3Service.uploadFile(file);

        const newMessageTempt = {
            userId,
            content,
            type,
        };

        if (channelId) {
            newMessageTempt.channelId = channelId;
        } else {
            newMessageTempt.conversationId = conversationId;
        }

        const newMessage = new Message({
            ...newMessageTempt,
        });

        // l??u xu???ng
        const saveMessage = await newMessage.save();

        return this.updateWhenHasNewMessage(
            saveMessage,
            conversationId,
            userId,
        );
    };

    // send file base64
    addFileWithBase64 = async (
        fileInfo,
        type,
        conversationId,
        channelId,
        userId,
    ) => {
        await messageValidate.validateFileMessageWithBase64(
            fileInfo,
            type,
            conversationId,
            channelId,
            userId,
        );
        const { fileBase64, fileName, fileExtension } = fileInfo;

        // upload ???nh
        const content = await awsS3Service.uploadWithBase64(
            fileBase64,
            fileName,
            fileExtension,
        );

        const newMessageTempt = {
            userId,
            content,
            type,
        };

        if (channelId) {
            newMessageTempt.channelId = channelId;
        } else {
            newMessageTempt.conversationId = conversationId;
        }

        const newMessage = new Message({
            ...newMessageTempt,
        });
        const saveMessage = await newMessage.save();

        return this.updateWhenHasNewMessage(
            saveMessage,
            conversationId,
            userId,
        );
    };

    updateWhenHasNewMessage = async (saveMessage, conversationId, userId) => {
        const { _id, channelId } = saveMessage;

        if (channelId) {
            await lastViewService.updateLastViewOfChannel(
                conversationId,
                channelId,
                userId,
            );
        } else {
            Promise.all([
                Conversation.updateOne(
                    { _id: conversationId },
                    { lastMessageId: _id },
                ),
                lastViewService.updateLastViewOfConversation(
                    conversationId,
                    userId,
                ),
            ]);
        }

        const { type } = await Conversation.findById(conversationId);

        return await this.getById(_id, type);
    };

    // thu h???i tin nh???n
    deleteById = async (_id, user) => {
        const message = await Message.getById(_id);
        const { userId, conversationId, channelId } = message;

        if (userId != user) {
            throw new MyError('Not permission delete message');
        }

        await Message.updateOne({ _id }, { isDeleted: true });

        let conversationTempt = conversationId;
        if (channelId) {
            const channel = await Channel.getById(channelId);
            conversationTempt = channel.conversationId;
        }

        return {
            _id,
            conversationId: conversationTempt,
            channelId,
        };
    };

    // xo?? ??? ph??a t??i
    deleteOnlyMeById = async (_id, userId) => {
        const message = await Message.getById(_id);
        const { deletedUserIds, isDeleted } = message;

        // tin nh???n ???? thu h???i
        if (isDeleted) {
            return;
        }

        const index = deletedUserIds.findIndex(
            (userIdEle) => userIdEle == userId,
        );
        // t??m th???y, th?? kh??ng th??m v?? n???a
        if (index !== -1) {
            return;
        }

        await Message.updateOne({ _id }, { $push: { deletedUserIds: userId } });
    };

    // th??? reaction
    // check xem userId c?? trong group ch???a tin nh???n n??y kh??ng
    addReaction = async (_id, type, userId) => {
        const numberType = parseInt(type);
        if (numberType < 1 || numberType > 6) {
            throw new MyError('Reaction type invalid');
        }

        const message = await Message.getById(_id);
        const { isDeleted, deletedUserIds, reacts, conversationId, channelId } =
            message;

        // n???u tin nh???n ???? x??a
        if (isDeleted || deletedUserIds.includes(userId)) {
            throw new MyError('Message was deleted');
        }

        // t??m react th??? b???i user
        const reactIndex = reacts.findIndex(
            (reactEle) => reactEle.userId == userId,
        );

        const reactTempt = [...reacts];
        // kh??ng t??m th???y
        if (reactIndex === -1) {
            reactTempt.push({ userId, type });
        } else {
            reactTempt[reactIndex] = { userId, type };
        }

        await Message.updateOne(
            { _id },
            {
                $set: {
                    reacts: reactTempt,
                },
            },
        );
        const user = await User.getSummaryById(userId);

        let conversationTempt = conversationId;
        if (channelId) {
            const channel = await Channel.getById(channelId);
            conversationTempt = channel.conversationId;
        }

        return {
            _id,
            conversationId: conversationTempt,
            channelId,
            user,
            type,
        };
    };

    deleteAll = async (conversationId, userId) => {
        Promise.all([
            Member.getByConversationIdAndUserId(conversationId, userId),
            Message.updateMany(
                { conversationId, deletedUserIds: { $nin: [userId] } },
                { $push: { deletedUserIds: userId } },
            ),
        ]).then();
    };

    getListFiles = async (
        conversationId,
        userId,
        type,
        senderId,
        startTime,
        endTime,
    ) => {
        if (type !== 'IMAGE' && type !== 'VIDEO' && type !== 'FILE') {
            throw new MyError('Message type invalid, only image, video, file');
        }

        const startDate = dateUtils.toDate(startTime);
        const endDate = dateUtils.toDate(endTime);

        await Conversation.getByIdAndUserId(conversationId, userId);

        const query = {
            conversationId,
            type,
            isDeleted: false,
            deletedUserIds: { $nin: [userId] },
        };

        if (senderId) {
            query.userId = senderId;
        }

        if (startDate && endDate) {
            query.createdAt = { $gte: startDate, $lte: endDate };
        }

        const files = await Message.find(query, {
            userId: 1,
            content: 1,
            type: 1,
            createdAt: 1,
        });

        return files;
    };

    getAllFiles = async (conversationId, userId) => {
        await Conversation.getByIdAndUserId(conversationId, userId);

        const images = await Message.getListFilesByTypeAndConversationId(
            'IMAGE',
            conversationId,
            userId,
            0,
            8,
        );

        const videos = await Message.getListFilesByTypeAndConversationId(
            'VIDEO',
            conversationId,
            userId,
            0,
            8,
        );
        const files = await Message.getListFilesByTypeAndConversationId(
            'FILE',
            conversationId,
            userId,
            0,
            8,
        );

        return {
            images,
            videos,
            files,
        };
    };

    addVoteMessage = async (voteMessageInfo, userId) => {
        const { content, options, conversationId } =
            await messageValidate.validateVoteMessage(voteMessageInfo, userId);

        const newMessage = new Message({
            userId,
            content,
            type: 'VOTE',
            options: options.map((optionNameEle) => {
                return {
                    name: optionNameEle,
                    userIds: [],
                };
            }),
            conversationId,
        });

        // l??u xu???ng
        const saveMessage = await newMessage.save();

        const { _id, createdAt } = saveMessage;
        Promise.all([
            // update l???i message m???i nh???t
            Conversation.updateOne(
                { _id: conversationId },
                { lastMessageId: _id },
            ),
            Member.updateOne(
                { conversationId, userId },
                { $set: { lastView: createdAt } },
            ),
        ]).then();

        return await this.getById(_id, true);
    };

    shareMessage = async (messageId, conversationId, userId) => {
        const message = await Message.getById(messageId);
        const { content, type } = message;

        await Conversation.getByIdAndUserId(message.conversationId, userId);
        const conversationShare = await Conversation.getByIdAndUserId(
            conversationId,
            userId,
        );

        if (type === 'NOTIFY' || type === 'VOTE') {
            throw new MyError('Not share message type is NOTIFY or Vote');
        }

        const newMessage = new Message({
            userId,
            content,
            type,
            conversationId,
        });

        // l??u xu???ng
        const saveMessage = await newMessage.save();

        const { _id, createdAt } = saveMessage;
        Promise.all([
            // update l???i message m???i nh???t
            Conversation.updateOne(
                { _id: conversationId },
                { lastMessageId: _id },
            ),
            Member.updateOne(
                { conversationId, userId },
                { $set: { lastView: createdAt } },
            ),
        ]);

        return await this.getById(_id, conversationShare.type);
    };

    addNotifyMessage = async (content, conversationId, userId) => {
        // tin nh???n th??m v??o group
        const newMessage = new Message({
            userId,
            content,
            type: 'NOTIFY',
            conversationId,
        });

        const { _id, createdAt } = await newMessage.save();

        Promise.all([
            Conversation.updateOne(
                { _id: conversationId },
                { lastMessageId: _id },
            ),
            Member.updateOne(
                { conversationId, userId },
                { lastView: createdAt },
            ),
        ]).then();

        return this.getById(_id, true);
    };
}

module.exports = new MessageService();
