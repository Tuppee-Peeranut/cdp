import 'dotenv/config';
import { seedSuperAdmin } from './superAdmin.js';

seedSuperAdmin()
  .then(() => {
    console.log('Super admin seeded');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed to seed super admin', err);
    process.exit(1);
  });
