const Classify = require('../models/Classify');
const Color = require('../models/Color');

const NotFoundError = require('../exception/NotFoundError');

const commonUtils = require('../../utils/commonUtils');

class ClassifyService {
    getAllColors = async () => {
        return await Color.find({});
    };

    getRandomColor = async () => {
        const colors = await Color.find({});
        const index = commonUtils.getRandomInt(0, colors.length - 1);

        return colors[index].code;
    };

    getList = async (userId) => {
        return await Classify.aggregate([
            { $match: { userId: ObjectId(userId) } },
            {
                $lookup: {
                    from: 'colors',
                    localField: 'colorId',
                    foreignField: '_id',
                    as: 'color',
                },
            },
            { $unwind: '$color' },
            { $project: { _id: 1, name: 1, color: 1, conversationIds: 1 } },
        ]);
    };

    add = async (userId, classify) => {
        await this.validate(userId, classify);
        const { name, colorId } = classify;

        const newClassify = new Classify({
            name,
            colorId,
            userId,
        });

        const { _id } = await newClassify.save();

        return {
            _id,
            name,
            colorId,
        };
    };

    validate = async (userId, classify) => {
        const { _id, name, colorId } = classify;

        // check color phai ton tai
        await Color.checkById(colorId);

        // check name
        if (!name || name.length < 1 || name.length > 50) {
            throw new MyError('Name not valid');
        }

        let existsName;
        // update
        if (_id) {
            existsName = await Classify.findOne({
                _id: { $ne: _id },
                name,
                userId,
            });
        } else {
            existsName = await Classify.findOne({ name, userId });
        }

        if (existsName) {
            throw new MyError('Name exists');
        }
    };

    update = async (userId, classify) => {
        await this.validate(userId, classify);
        const { _id, name, colorId } = classify;

        const queryResult = await Classify.updateOne({ _id, userId }, { name, colorId });

        const { nModified } = queryResult;

        if (nModified === 0) {
            throw new NotFoundError('Classify');
        }
    };
}

module.exports = new ClassifyService();
