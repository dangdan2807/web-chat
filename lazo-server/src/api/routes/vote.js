const router = require('express').Router();
const VoteController = require('../controllers/VoteController');

const voteRouter = (io) => {
    const voteController = new VoteController(io);

    router.get('/:conversationId', voteController.getListVotesByConversationId);
    router.post('', voteController.addVoteMessage);
    router.post('/:messageId', voteController.addOptions);


    return router;
};

module.exports = voteRouter;