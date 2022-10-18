const MyError = require('../exception/MyError');

const User = require('../models/User');

const userService = require('./UserService');
const awsS3Service = require('./AwsS3Service');

const userValidate = require('../validate/userValidate');
const messageValidate = require('../validate/messageValidate');

class MeService {
    getProfile = async (_id) => {
        const user = await User.getById(_id);

        return user;
    };

    updateProfile = async (_id, profile) => {
        if (!profile) {
            throw new MyError('Profile invalid');
        }

        const profileWasValidate = userValidate.checkProfile(profile);

        // check user
        await User.getById(_id);

        await User.updateOne({ _id }, { ...profileWasValidate });
    };

    changeAvatar = async (_id, file) => {
        this.checkImage(file);

        const user = await User.getById(_id);
        const { avatar } = user;
        if (avatar) {
            await awsS3Service.deleteFile(avatar);
        }

        const avatarUrl = await awsS3Service.uploadFile(file);
        await User.updateOne({ _id }, { avatar: avatarUrl });

        return avatarUrl;
    };

    changeCoverImage = async (_id, file) => {
        this.checkImage(file);

        const user = await User.getById(_id);
        const { coverImage } = user;
        if (coverImage) await awsS3Service.deleteFile(coverImage);

        const coverImageUrl = await awsS3Service.uploadFile(file);
        await User.updateOne({ _id }, { coverImage: coverImageUrl });

        return coverImageUrl;
    };

    changeAvatarWithBase64 = async (_id, fileInfo) => {
        messageValidate.validateImageWithBase64(fileInfo);

        const user = await User.getById(_id);
        const { avatar } = user;
        if (avatar) await awsS3Service.deleteFile(avatar);

        const { fileName, fileExtension, fileBase64 } = fileInfo;
        const avatarUrl = await awsS3Service.uploadWithBase64(fileBase64, fileName, fileExtension);
        await User.updateOne({ _id }, { avatar: avatarUrl });

        return avatarUrl;
    };

    changeCoverImageWithBase64 = async (_id, fileInfo) => {
        messageValidate.validateImageWithBase64(fileInfo);

        const user = await User.getById(_id);
        const { coverImage } = user;
        if (coverImage) await awsS3Service.deleteFile(coverImage);

        const { fileName, fileExtension, fileBase64 } = fileInfo;
        const coverImageUrl = await awsS3Service.uploadWithBase64(
            fileBase64,
            fileName,
            fileExtension,
        );
        await User.updateOne({ _id }, { coverImage: coverImageUrl });

        return coverImageUrl;
    };

    checkImage = (file) => {
        const { mimetype } = file;

        if (mimetype !== 'image/jpeg' && mimetype !== 'image/png') {
            throw new MyError('Image invalid');
        }
    };

    getPhoneBooks = async (_id) => {
        const user = await User.getById(_id);
        const { phoneBooks } = user;

        const result = [];
        for (const userPhoneBookEle of phoneBooks) {
            const { name, phone } = userPhoneBookEle;

            try {
                const searchUser = await userService.getStatusFriendOfUser(_id, phone);

                result.push({ ...searchUser, isExists: true });
            } catch (err) {
                result.push({ name, username: phone, isExists: false });
            }
        }

        return result;
    };

    syncPhoneBooks = async (_id, phones) => {
        userValidate.validatePhonesList(phones);
        await User.getById(_id);
        await User.updateOne({ _id }, { $set: { phoneBooks: phones } });
    };
}

module.exports = new MeService();
