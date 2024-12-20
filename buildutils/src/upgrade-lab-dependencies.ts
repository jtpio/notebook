import fs from 'fs';
import path from 'path';

const PACKAGE_JSON_PATHS: string[] = [
  'app/package.json',
  'buildutils/package.json',
  'package.json',
  'packages/application-extension/package.json',
  'packages/application/package.json',
  'packages/console-extension/package.json',
  'packages/docmanager-extension/package.json',
  'packages/documentsearch-extension/package.json',
  'packages/help-extension/package.json',
  'packages/lab-extension/package.json',
  'packages/notebook-extension/package.json',
  'packages/terminal-extension/package.json',
  'packages/tree-extension/package.json',
  'packages/tree/package.json',
  'packages/ui-components/package.json',
];

const DEPENDENCY_GROUP = '@jupyterlab';

interface IVersion {
  major: number;
  minor: number;
  patch: number;
  preRelease?: string;
}

function parseVersion(version: string): IVersion {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:(a|b|rc)(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }

  const [, major, minor, patch, type, preVersion] = match;
  const baseVersion = {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
  };

  if (type && preVersion) {
    return {
      ...baseVersion,
      preRelease: `${type}${preVersion}`,
    };
  }

  return baseVersion;
}

function getVersionRange(version: IVersion): string {
  const baseVersion = `${version.major}.${version.minor}.${version.patch}`;
  if (version.preRelease) {
    // For pre-releases, we want to be exact with the version
    return `==${baseVersion}${version.preRelease}`;
  }
  return `>=${baseVersion},<${version.major}.${version.minor + 1}`;
}

function updateVersionInFile(
  filePath: string,
  pattern: RegExp,
  version: IVersion,
  isGlobal = false
): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const versionRange = getVersionRange(version);
  const updatedContent = content.replace(pattern, `$1${versionRange}`);
  fs.writeFileSync(filePath, updatedContent);
}

async function updatePackageJson(newVersion: string): Promise<void> {
  const url = `https://raw.githubusercontent.com/jupyterlab/jupyterlab/v${newVersion}/jupyterlab/staging/package.json`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorMessage = `Failed to fetch package.json from ${url}. HTTP status code: ${response.status}`;
    throw new Error(errorMessage);
  }

  const newPackageJson = await response.json();

  for (const packageJsonPath of PACKAGE_JSON_PATHS) {
    const filePath: string = path.resolve(packageJsonPath);
    const existingPackageJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const newDependencies = {
      ...newPackageJson.devDependencies,
      ...newPackageJson.resolutions,
    };

    updateDependencyVersion(existingPackageJson, newDependencies);

    fs.writeFileSync(
      filePath,
      JSON.stringify(existingPackageJson, null, 2) + '\n'
    );
  }
}

function updateDependencyVersion(existingJson: any, newJson: any): void {
  if (!existingJson) {
    return;
  }

  const sectionPaths: string[] = [
    'resolutions',
    'dependencies',
    'devDependencies',
  ];

  for (const section of sectionPaths) {
    if (!existingJson[section]) {
      continue;
    }

    const updated = existingJson[section];

    for (const [pkg, version] of Object.entries<string>(
      existingJson[section]
    )) {
      if (pkg.startsWith(DEPENDENCY_GROUP) && pkg in newJson) {
        if (version[0] === '^' || version[0] === '~') {
          updated[pkg] = version[0] + absoluteVersion(newJson[pkg]);
        } else {
          updated[pkg] = absoluteVersion(newJson[pkg]);
        }
      }
    }
  }
}

function absoluteVersion(version: string): string {
  if (version.length > 0 && (version[0] === '^' || version[0] === '~')) {
    return version.substring(1);
  }
  return version;
}

async function updatePyprojectToml(version: IVersion): Promise<void> {
  const filePath = path.resolve('pyproject.toml');

  // Update the build-system requires
  const buildSystemPattern =
    /(requires\s*=\s*\[".*?jupyterlab)(?:>=|==)[\d.]+(?:,<[\d.]+)?(?="])/;
  updateVersionInFile(filePath, buildSystemPattern, version);

  // Update the project dependencies
  const dependenciesPattern =
    /(jupyterlab)(?:>=|==)[\d.]+(?:,<[\d.]+)?(?="|,|\s|$)/;
  updateVersionInFile(filePath, dependenciesPattern, version);
}

async function updatePreCommitConfig(version: IVersion): Promise<void> {
  const filePath = path.resolve('.pre-commit-config.yaml');
  const pattern = /(jupyterlab)(?:>=|==)[\d.]+(?:,<[\d.]+)?(?="|,|\s|$)/;
  updateVersionInFile(filePath, pattern, version);
}

async function updateWorkflowFiles(version: IVersion): Promise<void> {
  const workflowDir = path.resolve('.github', 'workflows');
  const files = fs.readdirSync(workflowDir);
  const pattern = /(jupyterlab)(?:>=|==)[\d.]+(?:,<[\d.]+)?(?="|,|\s|$)/g;

  for (const file of files) {
    const filePath = path.join(workflowDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    if (content.includes('jupyterlab>=')) {
      updateVersionInFile(filePath, pattern, version, true);
    }
  }
}

async function upgradeLabDependencies(): Promise<void> {
  const args: string[] = process.argv.slice(2);

  if (args.length !== 2 || args[0] !== '--set-version') {
    console.error('Usage: node script.js --set-version <version>');
    process.exit(1);
  }

  const version = parseVersion(args[1]);
  await updatePackageJson(args[1]); // Keep original string version for package.json
  await updatePyprojectToml(version);
  await updatePreCommitConfig(version);
  await updateWorkflowFiles(version);
}

upgradeLabDependencies();
