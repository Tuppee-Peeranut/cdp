import passport from 'passport';
import { Strategy as OIDCStrategy } from 'passport-openidconnect';
import db from './db.js';

passport.serializeUser((user, done) => {
  done(null, user.sub);
});

passport.deserializeUser(async (sub, done) => {
  try {
    const { rows } = await db.query('SELECT * FROM oidc_users WHERE sub = $1', [sub]);
    done(null, rows[0]);
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
}, async (issuer, sub, profile, accessToken, refreshToken, params, done) => {
  try {
    const name = profile.displayName || '';
    const email = profile.emails && profile.emails[0] && profile.emails[0].value;
    const { rows } = await db.query('SELECT * FROM oidc_users WHERE sub = $1', [sub]);
    if (rows.length === 0) {
      await db.query('INSERT INTO oidc_users (provider, sub, name, email) VALUES ($1, $2, $3, $4)', [issuer, sub, name, email]);
    }
    return done(null, { sub, name, email, id_token: params.id_token });
  } catch (err) {
    return done(err);
  }
}));
