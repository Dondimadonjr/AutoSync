const { Router } = require('express');
const { generarPost } = require('../controllers/post.controller');
const { validate } = require('../middlewares/validate.middleware');
const { GenerarPostSchema } = require('../schemas/post.schema');

const router = Router();

router.post('/generar-post', validate(GenerarPostSchema), generarPost);

module.exports = router;
