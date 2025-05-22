import fs from 'fs';
import path from 'path';

export interface TestScenario {
  name: string;
  description: string;
  request_payload: unknown;
  expected_exit_code: number;
  expected_stdout?: unknown;
  expected_stderr?: {
    contains?: string;
  };
  should_show_notice?: boolean;
  notice_code?: string;
  env_vars?: Record<string, string>;
  setup_files?: Array<{
    path: string;
    content: string;
    base_dir?: string;
    encoding?: string;
  }>;
  mocked_responses?: Array<{
    url_pattern: string;
    response_body: string;
    response_status: number;
    response_headers?: Record<string, string>;
  }>;
  setup_filesystem?: Array<{
    type:
      | 'createFile'
      | 'createDirectory'
      | 'createSymlink'
      | 'createBinaryFile'
      | 'createMultipleFiles'
      | 'createZipArchive'
      | 'createTarGzArchive'
      | 'createEmptyZipArchive';
    path?: string;
    content?: string;
    target?: string;
    link?: string;
    encoding?: string;
    mtime?: string;
    ctime?: string;
    binary_content?: number[];
    filename_pattern?: string;
    pattern?: string;
    content_template?: string;
    permissions?: string;
    archive_path?: string;
    source_files?: string[];
    source_paths?: string[];
  }>;
  cleanup_filesystem?: string[];
  filesystem_effects?: Array<{
    type: 'file_exists' | 'file_not_exists' | 'directory_exists' | 'directory_not_exists';
    path: string;
    content?: string;
  }>;
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
