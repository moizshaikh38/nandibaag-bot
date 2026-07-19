require('dotenv').config();
const Joi = require('joi');

const envSchema = Joi.object({
  MONGO_URI: Joi.string().required().description('MongoDB connection URI'),
  JWT_SECRET: Joi.string().required().description('Secret key for JWT token signing'),
  JWT_EXPIRES_IN: Joi.string().required().description('JWT token expiration time (e.g., "7d")'),
  OPENROUTER_API_KEY: Joi.string().required().description('OpenRouter API key for AI calls'),
  OPENROUTER_MODEL_PRIMARY: Joi.string().required().description('Primary OpenRouter model to use'),
  // NOTE: OPENROUTER_MODEL_FALLBACK_1/2 removed — fallback models are now hardcoded
  // in aiService.js as a 7-model chain across 6 providers for maximum resilience.
  PORT: Joi.number().default(7000).description('Server port'),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development').description('Environment'),
  RESORT_CONTACT_1: Joi.string().required().description('Primary resort contact number'),
  RESORT_CONTACT_2: Joi.string().required().description('Secondary resort contact number'),
  RESORT_CONTACT_3: Joi.string().required().description('Tertiary resort contact number'),
  ADMIN_DEFAULT_EMAIL: Joi.string().email().required().description('Default admin email'),
  ADMIN_DEFAULT_PASSWORD: Joi.string().required().description('Default admin password'),
  FRONTEND_URL: Joi.string().uri().required().description('Frontend application URL'),



  // ── Ollama (local dev/testing ONLY — never in production) ───────────
  AI_TEST_MODE: Joi.boolean().default(false).description('Enable local Ollama-only mode for testing (replaces entire tier chain)'),
  OLLAMA_BASE_URL: Joi.string().default('http://localhost:11434/v1').description('Ollama OpenAI-compatible endpoint'),
  OLLAMA_MODEL: Joi.string().default('llama3.2').description('Ollama model name'),

  // ── Groq (production tier) ──────────────────────────────────────────
  GROQ_API_KEY: Joi.string().allow('').default('').description('Groq API key'),
  GROQ_MODEL: Joi.string().default('llama-3.3-70b-versatile').description('Groq model name'),
  GROQ_BASE_URL: Joi.string().default('https://api.groq.com/openai/v1').description('Groq OpenAI-compatible endpoint'),

  // ── Cloudflare Workers AI Tier (optional) ─────────────────────────
  CLOUDFLARE_ACCOUNT_ID: Joi.string().allow('').default('').description('Cloudflare Account ID'),
  CLOUDFLARE_API_TOKEN: Joi.string().allow('').default('').description('Cloudflare API Token'),
  CLOUDFLARE_MODEL: Joi.string().default('@cf/meta/llama-3.1-8b-instruct').description('Cloudflare AI Model'),


}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  console.error('Environment validation error:');
  console.error(error.details.map(detail => `  - ${detail.path.join('.')}: ${detail.message}`).join('\n'));
  process.exit(1);
}

module.exports = {
  mongoUri: envVars.MONGO_URI,
  jwtSecret: envVars.JWT_SECRET,
  jwtExpiresIn: envVars.JWT_EXPIRES_IN,
  openrouterApiKey: envVars.OPENROUTER_API_KEY,
  openrouterModelPrimary: envVars.OPENROUTER_MODEL_PRIMARY,
  port: envVars.PORT,
  nodeEnv: envVars.NODE_ENV,
  resortContact1: envVars.RESORT_CONTACT_1,
  resortContact2: envVars.RESORT_CONTACT_2,
  resortContact3: envVars.RESORT_CONTACT_3,
  adminDefaultEmail: envVars.ADMIN_DEFAULT_EMAIL,
  adminDefaultPassword: envVars.ADMIN_DEFAULT_PASSWORD,
  frontendUrl: envVars.FRONTEND_URL,



  // Cloudflare settings
  cloudflareAccountId: envVars.CLOUDFLARE_ACCOUNT_ID,
  cloudflareApiToken: envVars.CLOUDFLARE_API_TOKEN,
  cloudflareModel: envVars.CLOUDFLARE_MODEL,



  // Ollama settings (local dev/testing only)
  aiTestMode: envVars.AI_TEST_MODE,
  ollamaBaseUrl: envVars.OLLAMA_BASE_URL,
  ollamaModel: envVars.OLLAMA_MODEL,

  // Groq settings (production tier)
  groqApiKey: envVars.GROQ_API_KEY,
  groqModel: envVars.GROQ_MODEL,
  groqBaseUrl: envVars.GROQ_BASE_URL
};
