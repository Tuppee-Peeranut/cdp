import passport from 'passport';
import { Strategy as OIDCStrategy } from 'passport-openidconnect';
import supabase from './db.js';

passport.serializeUser((user, done) => {
  done(null, user.sub);
});

passport.deserializeUser(async (sub, done) => {
  try {
    const { data, error } = await supabase.from('oidc_users').select('*').eq('sub', sub).maybeSingle();
    if (error) throw error;
    done(null, data);
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
    const { data, error } = await supabase.from('oidc_users').select('*').eq('sub', sub);
    if (error) throw error;
    if (!data || data.length === 0) {
      await supabase.from('oidc_users').insert({ provider: issuer, sub, name, email });
    }
    return done(null, { sub, name, email, id_token: params.id_token });
  } catch (err) {
    return done(err);
  }
}));
