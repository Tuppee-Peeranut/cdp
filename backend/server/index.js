import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import openaiProxy from './openaiProxy.js';
import { authorize } from './auth/supabaseAuth.js';
import superAdminRoutes from './auth/superAdminRoutes.js';
import domainsRoutes from './domainsRoutes.js';
import tasksRoutes from './tasksRoutes.js';
import { supabaseAdmin } from './supabaseClient.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.post('/api/chat', authorize(['admin', 'user']), openaiProxy);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/domains', domainsRoutes);
app.use('/api/tasks', tasksRoutes);

// Ensure a storage bucket exists (e.g., for profile avatars)
app.post('/api/storage/ensure-bucket', authorize(['admin', 'user']), async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    const isPublic = !!req.body?.public;
    if (!name) return res.status(400).json({ error: 'name required' });

    // List and check
    const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
    if (listErr) return res.status(400).json({ error: listErr.message });
    const exists = (buckets || []).some((b) => b.name === name);
    if (!exists) {
      const { error: createErr } = await supabaseAdmin.storage.createBucket(name, { public: isPublic });
      if (createErr && !/already exists/i.test(createErr.message || ''))
        return res.status(400).json({ error: createErr.message });
    }
    // Ensure public visibility if requested
    if (isPublic) {
      await supabaseAdmin.storage.updateBucket(name, { public: true }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to ensure bucket' });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
