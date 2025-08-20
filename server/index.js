import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import './auth/oidcStrategy.js';
import authRoutes from './auth/routes.js';
import { schema, root } from './auth/graphql.js';
import { graphqlHTTP } from 'express-graphql';
import openaiProxy from './openaiProxy.js';
import { authorize } from './auth/roles.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'session-secret',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/auth/graphql', graphqlHTTP({ schema, rootValue: root, graphiql: true }));
app.post('/api/chat', authorize('admin'), openaiProxy);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
