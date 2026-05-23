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
        SoundFile: {
          type: 'object',
          properties: {
            id:         { type: 'integer' },
            name:       { type: 'string', example: 'Morning Bell' },
            filename:   { type: 'string', example: '1779286988946_bell.mp3' },
            url:        { type: 'string', example: 'https://api.shikkhasomoy.com/uploads/1779286988946_bell.mp3' },
            size_bytes: { type: 'integer' },
            type:       { type: 'string', enum: ['bell', 'azan'] },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        SoundVersion: {
          type: 'object',
          properties: {
            type:    { type: 'string', enum: ['bell', 'azan'] },
            version: { type: 'integer', description: 'Max sound id — changes when library updates' },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name:       { type: 'string' },
                  url:        { type: 'string' },
                  checksum:   { type: 'string' },
                  size_bytes: { type: 'integer' },
                  type:       { type: 'string', enum: ['bell', 'azan'] },
                },
              },
            },
          },
        },
      },
    },
    tags: [
      { name: 'Auth',          description: 'Login for device & admin' },
      { name: 'Device',        description: 'Device heartbeat' },
      { name: 'Schedules',     description: 'Bell schedule management' },
      { name: 'Bell Sounds',   description: 'School bell / alarm audio (type=bell)' },
      { name: 'Azan Sounds',   description: 'Prayer (azan) audio files (type=azan)' },
      { name: 'Sounds',        description: 'Legacy endpoints — use type=bell|azan query' },
      { name: 'Azan Times',    description: 'Prayer schedule times per user' },
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
      // ── Bell sounds (alarms) ────────────────────────────────────────────────
      '/api/sounds/bell': {
        get: {
          tags: ['Bell Sounds'],
          summary: 'List bell / alarm audio files',
          description: 'Returns sounds where type=bell. Admin sees all bell files; users see admin uploads + their own.',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Bell sound list',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/SoundFile' } } } },
            },
          },
        },
      },
      '/api/sounds/bell/version': {
        get: {
          tags: ['Bell Sounds'],
          summary: 'Bell library version + files (device sync)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Bell version payload',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SoundVersion' } } },
            },
          },
        },
      },
      '/api/sounds/bell/upload': {
        post: {
          tags: ['Bell Sounds'],
          summary: 'Upload bell / alarm audio',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['sound'],
                  properties: { sound: { type: 'string', format: 'binary', description: '.mp3, .wav, or .ogg' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Bell sound uploaded (type=bell)' } },
        },
      },
      // ── Azan sounds (prayer audio) ────────────────────────────────────────────
      '/api/sounds/azan': {
        get: {
          tags: ['Azan Sounds'],
          summary: 'List azan audio files',
          description: 'Returns sounds where type=azan. Used with /api/azan prayer times (sound_file references filename).',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Azan sound list',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/SoundFile' } } } },
            },
          },
        },
      },
      '/api/sounds/azan/version': {
        get: {
          tags: ['Azan Sounds'],
          summary: 'Azan library version + files (device sync)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Azan version payload',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SoundVersion' } } },
            },
          },
        },
      },
      '/api/sounds/azan/upload': {
        post: {
          tags: ['Azan Sounds'],
          summary: 'Upload azan audio',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['sound'],
                  properties: { sound: { type: 'string', format: 'binary', description: '.mp3, .wav, or .ogg' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Azan sound uploaded (type=azan)' } },
        },
      },
      // ── Sounds (legacy / generic) ─────────────────────────────────────────────
      '/api/sounds/version': {
        get: {
          tags: ['Sounds'],
          summary: 'Sound version + files (device) — requires type query',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'type', in: 'query', required: true, schema: { type: 'string', enum: ['bell', 'azan'] }, description: 'Defaults to bell if omitted on legacy clients' }],
          responses: { 200: { description: 'Version payload', content: { 'application/json': { schema: { $ref: '#/components/schemas/SoundVersion' } } } } },
        },
      },
      '/api/sounds': {
        get: {
          tags: ['Sounds'],
          summary: 'List sounds by type (query)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'type', in: 'query', required: true, schema: { type: 'string', enum: ['bell', 'azan'] } }],
          responses: {
            200: {
              description: 'Filtered sound list',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/SoundFile' } } } },
            },
          },
        },
      },
      '/api/sounds/upload': {
        post: {
          tags: ['Sounds'],
          summary: 'Upload sound (body/query type=bell|azan)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['bell', 'azan'], default: 'bell' } }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['sound'],
                  properties: {
                    sound: { type: 'string', format: 'binary' },
                    type:  { type: 'string', enum: ['bell', 'azan'], default: 'bell' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Uploaded' } },
        },
      },
      '/api/sounds/{id}': {
        put: {
          tags: ['Bell Sounds', 'Azan Sounds'],
          summary: 'Rename sound (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
          },
          responses: { 200: { description: 'Updated' } },
        },
        delete: {
          tags: ['Bell Sounds', 'Azan Sounds'],
          summary: 'Delete sound (admin)',
          security: [{ bearerAuth: [] }],
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
