import express from 'express';
import { signup, login, logout, refresh } from './service.js';

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await signup({ username, password });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const tokens = await login({ username, password });
    res.json(tokens);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  try {
    const result = await logout({ refreshToken });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  try {
    const tokens = await refresh({ refreshToken });
    res.json(tokens);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
