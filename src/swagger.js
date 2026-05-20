const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'School Bell API',
      version: '1.0.0',
      description: 'REST API for School Bell Android App & Admin Panel',
    },
    servers: [
      { url: 'https://api.shikkhasomoy.com', description: 'Production Server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username:  { type: 'string', example: 'admin' },
            password:  { type: 'string', example: 'admin123' },
            device_id: { type: 'string', example: 'android-device-uuid' },
          },
        },
        Schedule: {
          type: 'object',
          properties: {
            id:           { type: 'integer' },
            label:        { type: 'string', example: 'Morning Bell' },
            hour:         { type: 'integer', example: 8 },
            minute:       { type: 'integer', example: 0 },
            days:         { type: 'integer', example: 62, description: 'Bitmask Mon-Sun (bit 0=Mon)' },
            sound_file:   { type: 'string', example: 'default_bell.mp3' },
            is_enabled:   { type: 'boolean' },
            routine_type: { type: 'string', example: 'SCHOOL' },
          },
        },
        Heartbeat: {
          type: 'object',
          properties: {
            device_id:        { type: 'string' },
            battery_level:    { type: 'integer', example: 85 },
            battery_charging: { type: 'boolean' },
            school_name:      { type: 'string' },
            status:           { type: 'string', example: 'online' },
          },
        },
        Announcement: {
          type: 'object',
          properties: {
            id:         { type: 'integer' },
            title:      { type: 'string' },
            message:    { type: 'string' },
            audio_url:  { type: 'string', nullable: true },
            priority:   { type: 'integer' },
            is_active:  { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id:          { type: 'integer' },
            username:    { type: 'string' },
            school_name: { type: 'string' },
            role:        { type: 'string', enum: ['admin', 'device'] },
            created_at:  { type: 'string', format: 'date-time' },
          },
        },
        Device: {
          type: 'object',
          properties: {
            id:               { type: 'integer' },
            device_id:        { type: 'string' },
            school_name:      { type: 'string' },
            battery_level:    { type: 'integer' },
            battery_charging: { type: 'boolean' },
            status:           { type: 'string', enum: ['online', 'offline'] },
            last_seen:        { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth',          description: 'Login for device & admin' },
      { name: 'Device',        description: 'Device heartbeat' },
      { name: 'Schedules',     description: 'Bell schedule management' },
      { name: 'Sounds',        description: 'Sound file management' },
      { name: 'Announcements', description: 'Announcement management' },
      { name: 'Admin',         description: 'Admin dashboard & user management' },
    ],
    paths: {
      // ── Auth ────────────────────────────────────────────────────────────────
      '/api/auth/login': {
        post: {
          tags: ['Auth'], summary: 'Device login',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
          responses: {
            200: { description: 'JWT token', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, school_name: { type: 'string' } } } } } },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/api/auth/admin/login': {
        post: {
          tags: ['Auth'], summary: 'Admin login (web panel)',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
          responses: {
            200: { description: 'JWT token' },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      // ── Device ──────────────────────────────────────────────────────────────
      '/api/device/heartbeat': {
        post: {
          tags: ['Device'], summary: 'Send device heartbeat', security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Heartbeat' } } } },
          responses: { 200: { description: 'OK' } },
        },
      },
      // ── Schedules ───────────────────────────────────────────────────────────
      '/api/schedules': {
        get: {
          tags: ['Schedules'], summary: 'Get enabled schedules (device)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'List of schedules', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Schedule' } } } } } },
        },
      },
      '/api/schedules/all': {
        get: {
          tags: ['Schedules'], summary: 'Get all schedules including disabled (admin)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'All schedules' } },
        },
      },
      '/api/schedules/{id}': {
        put: {
          tags: ['Schedules'], summary: 'Update schedule (admin)', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Schedule' } } } },
          responses: { 200: { description: 'Updated' } },
        },
        delete: {
          tags: ['Schedules'], summary: 'Delete schedule (admin)', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Deleted' } },
        },
      },
      // ── Sounds ──────────────────────────────────────────────────────────────
      '/api/sounds/version': {
        get: {
          tags: ['Sounds'], summary: 'Get sound version + file list (device)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Sound version and files' } },
        },
      },
      '/api/sounds': {
        get: {
          tags: ['Sounds'], summary: 'Get all sounds (admin)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'List of sounds' } },
        },
      },
      '/api/sounds/upload': {
        post: {
          tags: ['Sounds'], summary: 'Upload sound file (admin)', security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { sound: { type: 'string', format: 'binary' } } } } } },
          responses: { 200: { description: 'Uploaded' } },
        },
      },
      '/api/sounds/{id}': {
        delete: {
          tags: ['Sounds'], summary: 'Delete sound (admin)', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Deleted' } },
        },
      },
      // ── Announcements ───────────────────────────────────────────────────────
      '/api/announcements/latest': {
        get: {
          tags: ['Announcements'], summary: 'Get latest announcement (device)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Latest announcement', content: { 'application/json': { schema: { $ref: '#/components/schemas/Announcement' } } } } },
        },
      },
      '/api/announcements': {
        get: {
          tags: ['Announcements'], summary: 'Get announcements (device)', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
          responses: { 200: { description: 'List' } },
        },
        post: {
          tags: ['Announcements'], summary: 'Create announcement (admin)', security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' }, priority: { type: 'integer' } } } } } },
          responses: { 200: { description: 'Created' } },
        },
      },
      '/api/announcements/{id}': {
        delete: {
          tags: ['Announcements'], summary: 'Delete announcement (admin)', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Deleted' } },
        },
      },
      // ── Admin ───────────────────────────────────────────────────────────────
      '/api/admin/stats': {
        get: {
          tags: ['Admin'], summary: 'Dashboard stats', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Stats object' } },
        },
      },
      '/api/admin/devices': {
        get: {
          tags: ['Admin'], summary: 'All devices', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Device list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Device' } } } } } },
        },
      },
      '/api/admin/users': {
        get: {
          tags: ['Admin'], summary: 'All users', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'User list' } },
        },
        post: {
          tags: ['Admin'], summary: 'Create user', security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' }, school_name: { type: 'string' }, role: { type: 'string', enum: ['admin', 'device'] } } } } } },
          responses: { 200: { description: 'Created' } },
        },
      },
      '/api/admin/users/{id}': {
        put: {
          tags: ['Admin'], summary: 'Update user', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { school_name: { type: 'string' }, role: { type: 'string' }, password: { type: 'string' } } } } } },
          responses: { 200: { description: 'Updated' } },
        },
        delete: {
          tags: ['Admin'], summary: 'Delete user', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Deleted' } },
        },
      },
    },
  },
  apis: [],
};

module.exports = swaggerJsdoc(options);
