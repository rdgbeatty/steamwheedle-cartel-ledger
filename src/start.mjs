import { createLocalServer, DEFAULT_STATE } from './server.mjs';

try {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node 18.18 or newer is required.');
  const args = process.argv.slice(2);
  if (args.some((arg) => !/^--port=\d+$/.test(arg)) || args.length > 1) throw new Error('Usage: npm start -- --port=4174');
  const port = Number(args[0]?.split('=')[1] ?? 4174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port between 1024 and 65535.');
  const server = createLocalServer();
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Try npm start -- --port=${port + 1}`
      : error.code === 'EPERM' || error.code === 'EACCES' ? 'This environment does not permit opening a localhost port. Run npm start in your own terminal outside the restricted runner.'
      : 'Could not start the local server.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Forever market · http://localhost:${port}`);
    console.log('Open Local setup to enter your Blizzard developer client ID and secret.');
    console.log(`Local state: ${DEFAULT_STATE}`);
    console.log('Ctrl+C stops the server. No dependency installation is needed.');
  });
  const stop = () => { server.stopJobs(); server.close(); server.closeAllConnections(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) { console.error(error.message); process.exitCode = 1; }
