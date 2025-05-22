import fs from 'fs';
import path from 'path';

export interface TestScenario {
  name: string;
  description: string;
  request_payload: unknown;
  expected_exit_code: number;
  expected_stdout: unknown;
  should_show_notice?: boolean;
  notice_code?: string;
  env_vars?: Record<string, string>;
  setup_filesystem?: Array<{
    type: 'createFile' | 'createDirectory' | 'createSymlink' | 'createBinaryFile';
    path: string;
    content?: string;
    target?: string;
    link?: string;
    encoding?: string;
    mtime?: string;
    ctime?: string;
    binary_content?: number[];
    filename_pattern?: string;
  }>;
  cleanup_filesystem?: string[];
}

export interface ScenarioFile {
  scenarios: TestScenario[];
}

export function loadTestScenarios(scenarioFileName: string): TestScenario[] {
  const scenarioPath = path.join(__dirname, '..', 'scenarios', scenarioFileName);

  if (!fs.existsSync(scenarioPath)) {
    throw new Error(`Scenario file not found: ${scenarioPath}`);
  }

  const scenarioContent = fs.readFileSync(scenarioPath, 'utf8');
  const scenarioData: ScenarioFile = JSON.parse(scenarioContent);

  if (!scenarioData.scenarios || !Array.isArray(scenarioData.scenarios)) {
    throw new Error(`Invalid scenario file format: ${scenarioFileName}`);
  }

  return scenarioData.scenarios;
}
