import express from 'express';
import { createExtension, getUserExtensions, deleteExtension } from '../controllers/extensionController.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

router.use(verifyToken);

router.post('/create', createExtension);
router.get('/list', getUserExtensions);
router.delete('/delete/:id', deleteExtension);

export default router;