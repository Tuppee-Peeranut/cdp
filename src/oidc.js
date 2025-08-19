import { UserManager } from 'oidc-client-ts';

const settings = {
  authority: import.meta.env.VITE_OIDC_ISSUER,
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: import.meta.env.VITE_OIDC_SCOPES || 'openid profile email',
};

const manager = new UserManager(settings);

export function login() {
  return manager.signinRedirect();
}

export function logout() {
  return manager.signoutRedirect();
}

export function handleCallback() {
  return manager.signinCallback();
}

export function getUser() {
  return manager.getUser();
}
