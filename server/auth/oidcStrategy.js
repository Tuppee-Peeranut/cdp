import passport from 'passport';
import { Strategy as OIDCStrategy } from 'passport-openidconnect';
import db from './db.js';

passport.serializeUser((user, done) => {
  done(null, user.sub);
});

passport.deserializeUser((sub, done) => {
  try {
    const row = db.prepare('SELECT * FROM oidc_users WHERE sub = ?').get(sub);
    done(null, row);
  } catch (err) {
    done(err);
  }
});

passport.use('oidc', new OIDCStrategy({
  issuer: process.env.OIDC_ISSUER,
  authorizationURL: process.env.OIDC_AUTHORIZATION_URL,
  tokenURL: process.env.OIDC_TOKEN_URL,
  userInfoURL: process.env.OIDC_USERINFO_URL,
  clientID: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  callbackURL: process.env.OIDC_CALLBACK_URL,
  scope: process.env.OIDC_SCOPES || 'openid profile email'
}, (issuer, sub, profile, accessToken, refreshToken, params, done) => {
  try {
    const name = profile.displayName || '';
    const email = profile.emails && profile.emails[0] && profile.emails[0].value;
    const exists = db.prepare('SELECT * FROM oidc_users WHERE sub = ?').get(sub);
    if (!exists) {
      db.prepare('INSERT INTO oidc_users (provider, sub, name, email) VALUES (?, ?, ?, ?)')
        .run(issuer, sub, name, email);
    }
    return done(null, { sub, name, email, id_token: params.id_token });
  } catch (err) {
    return done(err);
  }
}));
