require('dotenv').config({ override: true });
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('ERROR: ANTHROPIC_API_KEY is not set.'); process.exit(1); }

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const app = express();
const client = new Anthropic({ apiKey });
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const supabaseAuth = supabaseAdmin;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

// Expose public config to frontend
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// Auth middleware — validates Bearer JWT from Supabase
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid token' });
  req.user = data.user;
  next();
}

// Get current user profile
app.get('/api/me', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('mm_profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();
  if (error) return res.status(404).json({ error: 'Profile not found' });
  res.json(data);
});

// List maps for current user
app.get('/api/maps', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('mm_maps')
    .select('id, title, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Save new map
app.post('/api/maps', requireAuth, async (req, res) => {
  const { title, data } = req.body;
  if (!title || !data) return res.status(400).json({ error: 'title and data required' });
  const { data: row, error } = await supabaseAdmin
    .from('mm_maps')
    .insert({ user_id: req.user.id, title, data })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(row);
});

// Load a single map
app.get('/api/maps/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('mm_maps')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();
  if (error) return res.status(404).json({ error: 'Map not found' });
  res.json(data);
});

// Update a map
app.put('/api/maps/:id', requireAuth, async (req, res) => {
  const { title, data } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (title) updates.title = title;
  if (data) updates.data = data;
  const { data: row, error } = await supabaseAdmin
    .from('mm_maps')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(row);
});

// Delete a map
app.delete('/api/maps/:id', requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('mm_maps')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Generate mind map via Claude
app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: 'You are a mind map generator. Return ONLY raw JSON, no markdown, no explanation.',
      messages: [{ role: 'user', content: message }],
    });
    res.json({ text: response.content[0].text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mind Map → http://localhost:${PORT}`));
