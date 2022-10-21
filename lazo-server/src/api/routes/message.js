const router = require('express').Router();
const uploadFile = require('../middleware/uploadFile');
const MessageController = require('../controllers/MessageController');

const messageRouter = (io) => {
    const messageController = new MessageController(io);

    router.get('/:conversationId', messageController.getList);
    router.get('/channel/:channelId', messageController.getListByChannelId);
    router.post('/text', messageController.addText);
    router.get('/:conversationId/files', messageController.getListFiles);
    router.post(
        '/files',
        uploadFile.singleUploadMiddleware,
        messageController.addFile
    );
    router.post('/files/base64', messageController.addFileWithBase64);
    router.delete('/:id', messageController.deleteById);

    return router;
};

module.exports = messageRouter;
