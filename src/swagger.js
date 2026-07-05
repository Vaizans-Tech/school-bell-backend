const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'School Bell API',
      version: '2.0.0',
      description: 'REST API for School Bell Android App & Admin Panel. Live announcement uses WebRTC signaling at /api/live/* (audio is peer-to-peer).',
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
          required: ['device_id'],
          properties: {
            device_id:        { type: 'string' },
            battery_level:    { type: 'integer', example: 85 },
            battery_charging: { type: 'boolean' },
          },
        },
        ScheduleTemplate: {
          type: 'object',
          properties: {
            id:           { type: 'integer' },
            label:        { type: 'string', example: 'Morning Bell' },
            hour:         { type: 'integer', example: 8 },
            minute:       { type: 'integer', example: 0 },
            days:         { type: 'integer', example: 62 },
            sound_file:   { type: 'string', example: 'default_bell.mp3' },
            is_enabled:   { type: 'boolean' },
            routine_type: { type: 'string', example: 'SCHOOL' },
          },
        },
        Announcement: {
          type: 'object',
          properties: {
            id:           { type: 'integer' },
            title:        { type: 'string' },
            message:      { type: 'string' },
            type:         { type: 'string', enum: ['recorded', 'scheduled'] },
            audio_url:    { type: 'string', nullable: true },
            hour:         { type: 'integer', nullable: true },
            minute:       { type: 'integer', nullable: true },
            days:         { type: 'integer', example: 62, description: 'Bitmask Mon=1..Sun=64' },
            scheduled_at: { type: 'string', example: '08:30', nullable: true },
            priority:     { type: 'integer' },
            is_active:    { type: 'boolean' },
            created_at:   { type: 'string', format: 'date-time' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id:          { type: 'integer' },
            username:    { type: 'string' },
            role:        { type: 'string', enum: ['admin', 'user'] },
            created_at:  { type: 'string', format: 'date-time' },
          },
        },
        Device: {
          type: 'object',
          properties: {
            id:               { type: 'integer' },
            device_id:        { type: 'string' },
            user_id:          { type: 'integer', nullable: true },
            username:         { type: 'string', nullable: true },
            battery_level:    { type: 'integer' },
            battery_charging: { type: 'boolean' },
            status:           { type: 'string', enum: ['online', 'offline'] },
            last_seen:        { type: 'string', format: 'date-time', nullable: true },
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
        IceServer: {
          type: 'object',
          properties: {
            urls:       { type: 'string', example: 'stun:stun.l.google.com:19302' },
            username:   { type: 'string' },
            credential: { type: 'string' },
          },
        },
        LiveSdp: {
          type: 'object',
          required: ['sdp', 'type'],
          properties: {
            sdp:  { type: 'string', description: 'SDP string' },
            type: { type: 'string', enum: ['offer', 'answer'] },
          },
        },
        LiveSession: {
          type: 'object',
          properties: {
            session_id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['waiting_player', 'player_joined', 'offer_sent', 'connected', 'ended'],
            },
            offer:  { $ref: '#/components/schemas/LiveSdp', nullable: true },
            answer: { $ref: '#/components/schemas/LiveSdp', nullable: true },
            created_at:   { type: 'integer', description: 'Unix ms' },
            connected_at: { type: 'integer', nullable: true },
          },
        },
        LiveIceCandidate: {
          type: 'object',
          properties: {
            candidate:     { type: 'string' },
            sdpMid:        { type: 'string', nullable: true },
            sdpMLineIndex: { type: 'integer', nullable: true },
          },
        },
      },
    },
    tags: [
      { name: 'Auth',          description: 'Login for device & admin' },
      { name: 'Device',        description: 'Device heartbeat' },
      { name: 'Schedules',     description: 'Per-user bell schedules + default templates gallery' },
      { name: 'Schedule Templates', description: 'Admin default schedules — users import via /import-templates' },
      { name: 'Bell Sounds',   description: 'School bell / alarm audio (type=bell)' },
      { name: 'Azan Sounds',   description: 'Prayer (azan) audio files (type=azan)' },
      { name: 'Sounds',        description: 'Legacy endpoints — use type=bell|azan query' },
      { name: 'Azan Times',    description: 'Prayer schedule times per user' },
      { name: 'Announcements', description: 'Announcement management' },
      { name: 'Live', description: 'WebRTC live announcement signaling (no media through server)' },
      { name: 'Admin',         description: 'Admin dashboard & user management' },
    ],
    paths: {
      // ── Auth ────────────────────────────────────────────────────────────────
      '/api/auth/login': {
        post: {
          tags: ['Auth'], summary: 'Device login',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
          responses: {
            200: { description: 'JWT token', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, username: { type: 'string' }, message: { type: 'string' } } } } } },
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
        post: {
          tags: ['Schedules'],
          summary: 'Create schedule for logged-in user',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Schedule' } } } },
          responses: { 200: { description: 'Created' } },
        },
      },
      '/api/schedules/all': {
        get: {
          tags: ['Schedules'], summary: 'Get all schedules for logged-in user (includes disabled)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'All schedules', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Schedule' } } } } } },
        },
      },
      '/api/schedules/version': {
        get: {
          tags: ['Schedules'], summary: 'Schedule change-detection token (device poll)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: '{ version: "count_timestamp" }' } },
        },
      },
      '/api/schedules/templates': {
        get: {
          tags: ['Schedule Templates'],
          summary: 'List default bell schedule templates (gallery)',
          description: 'Admin-managed defaults. Any authenticated user can read. Mobile app uses this before import.',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Template list',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ScheduleTemplate' } } } },
            },
          },
        },
        post: {
          tags: ['Schedule Templates'],
          summary: 'Create schedule template (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['label', 'hour', 'minute'],
                  properties: {
                    label: { type: 'string' },
                    hour: { type: 'integer' },
                    minute: { type: 'integer' },
                    days: { type: 'integer', default: 62 },
                    sound_file: { type: 'string', default: 'default_bell.mp3' },
                    is_enabled: { type: 'boolean', default: true },
                    routine_type: { type: 'string', default: 'SCHOOL' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Created' } },
        },
      },
      '/api/schedules/templates/{id}': {
        put: {
          tags: ['Schedule Templates'],
          summary: 'Update schedule template (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ScheduleTemplate' } } } },
          responses: { 200: { description: 'Updated' } },
        },
        delete: {
          tags: ['Schedule Templates'],
          summary: 'Delete schedule template (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Deleted' } },
        },
      },
      '/api/schedules/import-templates': {
        post: {
          tags: ['Schedule Templates', 'Schedules'],
          summary: 'Copy enabled templates into user schedules',
          description: 'Skips duplicates (same user_id + label + hour + minute). Returns imported count.',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Import result',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      imported: { type: 'integer' },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/schedules/admin/all': {
        get: {
          tags: ['Schedules', 'Admin'],
          summary: 'All user schedules (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'user_id', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: { description: 'Schedules with username' } },
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
          tags: ['Announcements'], summary: 'Get latest active announcement (device)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Latest announcement', content: { 'application/json': { schema: { $ref: '#/components/schemas/Announcement' } } } } },
        },
      },
      '/api/announcements/scheduled': {
        get: {
          tags: ['Announcements'], summary: 'List scheduled announcements (controller)', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Scheduled list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Announcement' } } } } } },
        },
        post: {
          tags: ['Announcements'], summary: 'Create scheduled announcement (legacy alias)', security: [{ bearerAuth: [] }],
          responses: { 201: { description: 'Created' } },
        },
      },
      '/api/announcements': {
        get: {
          tags: ['Announcements'], summary: 'List announcements', security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'all', in: 'query', schema: { type: 'boolean' }, description: 'Controller: include inactive/scheduled pending' },
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['recorded', 'scheduled'] } },
          ],
          responses: { 200: { description: 'List', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Announcement' } } } } } },
        },
        post: {
          tags: ['Announcements'],
          summary: 'Create announcement (unified — multipart or JSON)',
          description: 'Multipart fields: title*, message, type*, hour, minute, days, is_active, priority, audio (file). type=recorded|scheduled.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['title', 'type'],
                  properties: {
                    title: { type: 'string' },
                    message: { type: 'string' },
                    type: { type: 'string', enum: ['recorded', 'scheduled'] },
                    hour: { type: 'integer' },
                    minute: { type: 'integer' },
                    days: { type: 'integer', default: 62 },
                    is_active: { type: 'integer' },
                    priority: { type: 'integer' },
                    audio: { type: 'string', format: 'binary' },
                  },
                },
              },
              'application/json': {
                schema: { $ref: '#/components/schemas/Announcement' },
              },
            },
          },
          responses: { 201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Announcement' } } } } },
        },
      },
      '/api/announcements/{id}': {
        get: {
          tags: ['Announcements'], summary: 'Get single announcement', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Announcement', content: { 'application/json': { schema: { $ref: '#/components/schemas/Announcement' } } } } },
        },
        put: {
          tags: ['Announcements'], summary: 'Update announcement (multipart or JSON)', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Updated' } },
        },
        delete: {
          tags: ['Announcements'], summary: 'Delete announcement', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Deleted' } },
        },
      },
      // ── Live (WebRTC signaling) ─────────────────────────────────────────────
      '/api/live/config': {
        get: {
          tags: ['Live'],
          summary: 'Get STUN/TURN ICE servers',
          description: 'Returns ice_servers for WebRTC PeerConnection. Media never passes through the backend.',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'ICE server list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ice_servers: { type: 'array', items: { $ref: '#/components/schemas/IceServer' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/live/session': {
        post: {
          tags: ['Live'],
          summary: 'Create live session (controller)',
          description: 'Starts WebRTC signaling. Notifies player via WebSocket { type: live_session }.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['role'],
                  properties: {
                    role: { type: 'string', enum: ['controller'] },
                    device_id: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Session created with session_id and ice_servers' } },
        },
        get: {
          tags: ['Live'],
          summary: 'Get session state (poll offer/answer)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'session_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'role', in: 'query', required: true, schema: { type: 'string', enum: ['controller', 'player'] } },
            { name: 'device_id', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Session state for role' } },
        },
      },
      '/api/live/offer': {
        post: {
          tags: ['Live'],
          summary: 'Send SDP offer (controller)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['session_id', 'role'],
                  properties: {
                    session_id: { type: 'string', format: 'uuid' },
                    role: { type: 'string', enum: ['controller'] },
                    offer: { $ref: '#/components/schemas/LiveSdp' },
                    sdp: { type: 'string' },
                    type: { type: 'string', enum: ['offer'] },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Offer stored' } },
        },
      },
      '/api/live/answer': {
        post: {
          tags: ['Live'],
          summary: 'Send SDP answer (player)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['session_id', 'role'],
                  properties: {
                    session_id: { type: 'string', format: 'uuid' },
                    role: { type: 'string', enum: ['player'] },
                    answer: { $ref: '#/components/schemas/LiveSdp' },
                    sdp: { type: 'string' },
                    type: { type: 'string', enum: ['answer'] },
                    device_id: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Answer stored' } },
        },
      },
      '/api/live/ice': {
        post: {
          tags: ['Live'],
          summary: 'Submit ICE candidate',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['session_id', 'role', 'candidate'],
                  properties: {
                    session_id: { type: 'string', format: 'uuid' },
                    role: { type: 'string', enum: ['controller', 'player'] },
                    candidate: { oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/LiveIceCandidate' }] },
                    sdpMid: { type: 'string' },
                    sdpMLineIndex: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Candidate queued for peer' } },
        },
        get: {
          tags: ['Live'],
          summary: 'Poll ICE candidates from peer',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'session_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'role', in: 'query', required: true, schema: { type: 'string', enum: ['controller', 'player'] } },
          ],
          responses: { 200: { description: 'Peer ICE candidates (drained from queue)' } },
        },
      },
      '/api/live/end': {
        post: {
          tags: ['Live'],
          summary: 'End live session',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['session_id'],
                  properties: {
                    session_id: { type: 'string', format: 'uuid' },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Session ended; player notified via WebSocket live_end' } },
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
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['username', 'password'],
                  properties: {
                    username: { type: 'string' },
                    password: { type: 'string' },
                    role: { type: 'string', enum: ['admin', 'user'], default: 'user', description: 'Legacy "device" is stored as user' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Created' } },
        },
      },
      '/api/user/{userId}': {
        get: {
          tags: ['Users'], summary: 'Get user with devices', security: [{ bearerAuth: [] }],
          description: 'Admin can view any user. Regular users can only view their own profile.',
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: {
              description: 'User details with linked devices',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      username: { type: 'string' },
                      role: { type: 'string', enum: ['admin', 'user'] },
                      school_name: { type: 'string', nullable: true },
                      created_at: { type: 'string', format: 'date-time' },
                      devices: { type: 'array', items: { $ref: '#/components/schemas/Device' } },
                    },
                  },
                },
              },
            },
            403: { description: 'Access denied' },
            404: { description: 'User not found' },
          },
        },
      },
      '/api/admin/users/{id}': {
        put: {
          tags: ['Admin'], summary: 'Update user', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['admin', 'user'] },
                    password: { type: 'string' },
                  },
                },
              },
            },
          },
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
