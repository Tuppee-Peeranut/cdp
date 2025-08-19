import express from 'express';
import passport from 'passport';

const router = express.Router();

// Start OIDC login
router.get('/login', passport.authenticate('oidc'));

// OIDC callback handler
router.get('/callback',
  passport.authenticate('oidc', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/');
  }
);

// Logout and redirect through the provider
router.get('/logout', (req, res, next) => {
  const idToken = req.user && req.user.id_token;
  req.logout(err => {
    if (err) return next(err);
    const url = `${process.env.OIDC_LOGOUT_URL}?post_logout_redirect_uri=${encodeURIComponent(process.env.OIDC_POST_LOGOUT_REDIRECT_URI || '/')}` + (idToken ? `&id_token_hint=${idToken}` : '');
    res.redirect(url);
  });
});

// Current authenticated user
router.get('/me', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.json({ user: null });
  }
  res.json({ user: req.user });
});

export default router;
