import fs from 'node:fs';
import { listAgentRequests, getAgentRequest, submitAgentSEO } from '../services/AgentSEOService.js';

const [command, id, resultPath] = process.argv.slice(2);
try {
  let result;
  if (command === 'list') result = listAgentRequests();
  else if (command === 'show' && id) result = getAgentRequest(id);
  else if (command === 'complete' && id && resultPath) {
    const value = JSON.parse(fs.readFileSync(resultPath, 'utf8').replace(/^\uFEFF/, ''));
    result = submitAgentSEO(id, value);
  } else {
    throw new Error('Kullanım: node backend/scripts/agentSeo.mjs list | show <id> | complete <id> <result.json>');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
