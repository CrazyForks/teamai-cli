import { describe, it, expect } from 'vitest';
import { isContributeHintEnabled, TeamaiConfigSchema, LocalConfigSchema } from '../types.js';

describe('isContributeHintEnabled', () => {
  const env = {} as NodeJS.ProcessEnv;

  it('defaults to enabled when neither team nor user has an opinion', () => {
    expect(isContributeHintEnabled({}, {}, env)).toBe(true);
    expect(isContributeHintEnabled({}, { sharing: {} }, env)).toBe(true);
  });

  it('honors the team default', () => {
    expect(isContributeHintEnabled({}, { sharing: { contributeHint: { enabled: false } } }, env)).toBe(false);
    expect(isContributeHintEnabled({}, { sharing: { contributeHint: { enabled: true } } }, env)).toBe(true);
  });

  it('lets the user override the team default in both directions', () => {
    expect(isContributeHintEnabled({ contributeHintEnabled: true }, { sharing: { contributeHint: { enabled: false } } }, env)).toBe(true);
    expect(isContributeHintEnabled({ contributeHintEnabled: false }, { sharing: { contributeHint: { enabled: true } } }, env)).toBe(false);
    expect(isContributeHintEnabled({ contributeHintEnabled: false }, {}, env)).toBe(false);
  });

  it('TEAMAI_CONTRIBUTE_HINT_DISABLED=1 wins over every config layer', () => {
    const killed = { TEAMAI_CONTRIBUTE_HINT_DISABLED: '1' } as NodeJS.ProcessEnv;
    expect(isContributeHintEnabled({ contributeHintEnabled: true }, { sharing: { contributeHint: { enabled: true } } }, killed)).toBe(false);
    expect(isContributeHintEnabled({}, {}, { TEAMAI_CONTRIBUTE_HINT_DISABLED: '0' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('parses the new fields and leaves existing configs valid', () => {
    const team = TeamaiConfigSchema.parse({ team: 't', repo: 'r', sharing: { contributeHint: { enabled: false } } });
    expect(team.sharing.contributeHint?.enabled).toBe(false);
    expect(TeamaiConfigSchema.parse({ team: 't', repo: 'r' }).sharing.contributeHint).toBeUndefined();
    const local = LocalConfigSchema.parse({ repo: { localPath: '/x', remote: '' }, username: 'u', contributeHintEnabled: false });
    expect(local.contributeHintEnabled).toBe(false);
  });
});
