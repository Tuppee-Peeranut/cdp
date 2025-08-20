import { buildSchema } from 'graphql';
import { signup, login, logout, refresh, enrollMfa, verifyMfa } from './service.js';

export const schema = buildSchema(`
  type AuthPayload {
    accessToken: String
    refreshToken: String
    mfaRequired: Boolean
    mfaToken: String
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
  login,
  logout,
  refresh,
  enrollMfa,
  verifyMfa,
};
