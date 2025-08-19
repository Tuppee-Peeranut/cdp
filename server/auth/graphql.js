import { buildSchema } from 'graphql';
import { signup, login, logout, refresh } from './service.js';

export const schema = buildSchema(`
  type AuthPayload { accessToken: String!, refreshToken: String! }
  type Success { success: Boolean! }
  type Query { _empty: String }
  type Mutation {
    signup(username: String!, password: String!): Success!
    login(username: String!, password: String!): AuthPayload!
    logout(refreshToken: String!): Success!
    refresh(refreshToken: String!): AuthPayload!
  }
`);

export const root = {
  signup,
  login,
  logout,
  refresh,
};
