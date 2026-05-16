import type { Command, LocalCommandCall } from '../types/command.js'

const call: LocalCommandCall = async () => {
  return {
    type: 'text',
    value: '2026-05-09T06:09:30.048Z'
      ? `${'2.1.88'} (built ${'2026-05-09T06:09:30.048Z'})`
      : '2.1.88',
  }
}

const version = {
  type: 'local',
  name: 'version',
  description:
    'Print the version this session is running (not what autoupdate downloaded)',
  isEnabled: () => process.env.USER_TYPE === 'ant',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default version
