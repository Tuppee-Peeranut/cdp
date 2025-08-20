import express from 'express';
import passport from 'passport';
import { logEvent } from './logger.js';

const router = express.Router();

// Start OIDC login
router.get('/login', passport.authenticate('oidc'));

// OIDC callback handler
router.get('/callback', (req, res, next) => {
  passport.authenticate('oidc', (err, user) => {
    if (err || !user) {
      logEvent('login_failed', { method: 'oidc', error: err && err.message });
      return res.redirect('/');
    }
    req.logIn(user, err2 => {
      if (err2) return next(err2);
      logEvent('login_success', { method: 'oidc', userId: user.sub || user.id });
      res.redirect('/');
    });
  })(req, res, next);
});

// Logout and redirect through the provider
router.get('/logout', (req, res, next) => {
  const idToken = req.user && req.user.id_token;
  const userId = req.user && (req.user.sub || req.user.id);
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => {
      logEvent('logout', { method: 'oidc', userId });
      const url = `${process.env.OIDC_LOGOUT_URL}?post_logout_redirect_uri=${encodeURIComponent(process.env.OIDC_POST_LOGOUT_REDIRECT_URI || '/')}` + (idToken ? `&id_token_hint=${idToken}` : '');
      res.redirect(url);
    });
  });
});

router.get('/csrf', (req, res) => {
  res.json({ csrfToken: req.session.csrfToken });
});

// Current authenticated user
router.get('/me', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.json({ user: null });
  }
  res.json({ user: req.user });
});

export default router;
