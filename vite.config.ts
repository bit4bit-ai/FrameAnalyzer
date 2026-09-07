import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const keywordsFilePath = path.resolve(__dirname, 'keywords.json');

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'keywords-api',
          configureServer(server) {
            server.middlewares.use('/api/keywords', (req, res, next) => {
              if (req.method === 'GET') {
                try {
                  if (fs.existsSync(keywordsFilePath)) {
                    const data = fs.readFileSync(keywordsFilePath, 'utf-8');
                    res.setHeader('Content-Type', 'application/json');
                    res.end(data || '[]');
                  } else {
                    res.setHeader('Content-Type', 'application/json');
                    res.end('[]');
                  }
                } catch (err: any) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
                return;
              }

              if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk;
                });
                req.on('end', () => {
                  try {
                    const parsed = JSON.parse(body);
                    const keywords = Array.isArray(parsed) ? parsed : (parsed.keywords || []);
                    fs.writeFileSync(keywordsFilePath, JSON.stringify(keywords, null, 2), 'utf-8');
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true, count: keywords.length }));
                  } catch (err: any) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: err.message }));
                  }
                });
                return;
              }

              next();
            });

            server.middlewares.use('/api/settings', (req, res, next) => {
              const envLocalPath = path.resolve(__dirname, '.env.local');
              if (req.method === 'GET') {
                let apiKey = '';
                if (fs.existsSync(envLocalPath)) {
                  const content = fs.readFileSync(envLocalPath, 'utf-8');
                  const match = content.match(/GEMINI_API_KEY=([^\r\n]*)/);
                  if (match) apiKey = match[1].trim().replace(/^["']|["']$/g, '');
                }
                if (!apiKey) {
                  apiKey = env.GEMINI_API_KEY || '';
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ apiKey }));
                return;
              }

              if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk;
                });
                req.on('end', () => {
                  try {
                    const parsed = JSON.parse(body);
                    const apiKey = (parsed.apiKey || '').trim();
                    fs.writeFileSync(
                      envLocalPath,
                      `# Gemini API Key for FrameAnalyzer\nGEMINI_API_KEY=${apiKey}\nAPI_KEY=${apiKey}\n`,
                      'utf-8'
                    );
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true }));
                  } catch (err: any) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: err.message }));
                  }
                });
                return;
              }

              next();
            });

            server.middlewares.use('/api/resolve-directory', (req, res, next) => {
              if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                  try {
                    const parsed = JSON.parse(body);
                    const name = (parsed.name || '').trim();
                    const sampleFiles: string[] = parsed.sampleFiles || [];

                    if (!name) {
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ fullPath: null }));
                      return;
                    }

                    const userProfile = process.env.USERPROFILE || '';
                    const searchRoots = [
                      process.cwd(),
                      path.resolve(process.cwd(), '..'),
                      'C:\\DEVELOP',
                      userProfile,
                      path.join(userProfile, 'Videos'),
                      path.join(userProfile, 'Desktop'),
                      path.join(userProfile, 'Downloads'),
                      path.join(userProfile, 'Documents'),
                      'C:\\',
                      'D:\\',
                      'E:\\'
                    ];

                    let matchedPath: string | null = null;
                    for (const root of searchRoots) {
                      if (!root || !fs.existsSync(root)) continue;
                      if (path.basename(root).toLowerCase() === name.toLowerCase()) {
                        matchedPath = root;
                        break;
                      }

                      try {
                        const queue = [{ dir: root, depth: 0 }];
                        while (queue.length > 0) {
                          const item = queue.shift()!;
                          if (item.depth > 3) continue;
                          let entries: fs.Dirent[];
                          try { entries = fs.readdirSync(item.dir, { withFileTypes: true }); } catch { continue; }
                          for (const ent of entries) {
                            if (ent.isDirectory()) {
                              const fullChild = path.join(item.dir, ent.name);
                              if (ent.name.toLowerCase() === name.toLowerCase()) {
                                if (sampleFiles.length === 0) {
                                  matchedPath = fullChild;
                                  break;
                                }
                                try {
                                  const childFiles = fs.readdirSync(fullChild);
                                  if (sampleFiles.some(f => childFiles.includes(f))) {
                                    matchedPath = fullChild;
                                    break;
                                  }
                                } catch {}
                              }
                              if (item.depth < 2) queue.push({ dir: fullChild, depth: item.depth + 1 });
                            }
                          }
                          if (matchedPath) break;
                        }
                      } catch {}
                      if (matchedPath) break;
                    }

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ fullPath: matchedPath }));
                  } catch (err: any) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: err.message }));
                  }
                });
                return;
              }
              next();
            });
          }
        }
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

