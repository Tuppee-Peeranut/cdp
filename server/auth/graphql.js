import { buildSchema } from 'graphql';
import { signup, login, logout, refresh, enrollMfa, verifyMfa } from './service.js';

export const schema = buildSchema(`
  type AuthPayload {
    accessToken: String
    refreshToken: String
    mfaRequired: Boolean
    mfaToken: String
    role: String
  }
  type Success { success: Boolean! }
  type MfaEnrollment { otpauthUrl: String!, secret: String! }
  type Query { _empty: String }
  type Mutation {
    signup(username: String!, password: String!): Success!
    login(username: String!, password: String!): AuthPayload!
    logout(refreshToken: String!): Success!
    refresh(refreshToken: String!): AuthPayload!
    enrollMfa(username: String!, password: String!): MfaEnrollment!
    verifyMfa(mfaToken: String!, code: String!): AuthPayload!
  }
`);

export const root = {
  signup,
  login: async (args, context) => {
    const result = await login(args);
    if (context?.res) {
      context.res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
      });
    }
    return result;
  },
  logout: async (args, context) => {
    await logout(args);
    context?.res?.clearCookie('refreshToken');
    return { success: true };
  },
  refresh: async (args, context) => {
    const result = await refresh(args);
    if (context?.res) {
      context.res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
      });
    }
    return result;
  },
  enrollMfa,
  verifyMfa,
};
