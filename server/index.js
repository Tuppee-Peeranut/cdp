import express from 'express';
import cors from 'cors';
import authRoutes from './auth/routes.js';
import { schema, root } from './auth/graphql.js';
import { graphqlHTTP } from 'express-graphql';
import openaiProxy from './openaiProxy.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/auth/graphql', graphqlHTTP({ schema, rootValue: root, graphiql: true }));
app.post('/api/chat', openaiProxy);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
