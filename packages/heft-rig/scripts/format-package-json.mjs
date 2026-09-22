import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

const sortObjectAlphabetically = (obj) => {
  return Object.fromEntries(
    Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0])),
  );
};

const uniqueArray = (arr) => {
  return [...new Set(arr)];
};

const dashToPascal = (str) => {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
};

const PACKAGE_TYPE_DEFAULTS = {
  "kit-element": ({ _name }) => ({
    description: `<${_name}> custom element`,
    engines: { node: ">=24.13.0" },
    type: "module",
    scripts: {
      build: "node node_modules/@excom/heft-rig/scripts/vite-build.mjs",
      "build:watch":
        "node node_modules/@excom/heft-rig/scripts/vite-build-watch.mjs",
      format: "node node_modules/@excom/heft-rig/scripts/format.mjs",
      test: "node node_modules/@excom/heft-rig/scripts/vitest.mjs",
      coverage: "node node_modules/@excom/heft-rig/scripts/coverage.mjs",
      dev: "node node_modules/@excom/heft-rig/scripts/vite-dev.mjs",
      preview: "node node_modules/@excom/heft-rig/scripts/vite-preview.mjs",
    },
    dependencies: {
      "@excom/neutron": "workspace:^",
    },
    peerDependencies: {},
    devDependencies: {
      "@excom/heft-rig": "workspace:^",
    },
    keywords: [`${_name}`, "neutron", "custom-elements"],
  }),
  "element-base": ({ _name }) => ({
    description: `${dashToPascal(_name)} base for Neutron elements`,
    engines: { node: ">=24.13.0" },
    type: "module",
    scripts: {
      build: "node node_modules/@excom/heft-rig/scripts/vite-build.mjs",
      "build:watch":
        "node node_modules/@excom/heft-rig/scripts/vite-build-watch.mjs",
      format: "node node_modules/@excom/heft-rig/scripts/format.mjs",
      test: "node node_modules/@excom/heft-rig/scripts/vitest.mjs",
      coverage: "node node_modules/@excom/heft-rig/scripts/coverage.mjs",
      dev: "node node_modules/@excom/heft-rig/scripts/vite-dev.mjs",
      preview: "node node_modules/@excom/heft-rig/scripts/vite-preview.mjs",
    },
    dependencies: {
      "@excom/neutron": "workspace:^",
    },
    peerDependencies: {},
    devDependencies: {
      "@excom/heft-rig": "workspace:^",
    },
    keywords: [
      `${dashToPascal(_name)}`,
      _name,
      "neutron",
      "kit-element-base",
      "custom-elements",
    ],
  }),
  library: ({ _name }) => ({
    description: `${_name} library`,
    engines: { node: ">=24.13.0" },
    type: "module",
    scripts: {
      build: "node node_modules/@excom/heft-rig/scripts/vite-build.mjs",
      "build:watch":
        "node node_modules/@excom/heft-rig/scripts/vite-build-watch.mjs",
      format: "node node_modules/@excom/heft-rig/scripts/format.mjs",
      test: "node node_modules/@excom/heft-rig/scripts/vitest.mjs",
      coverage: "node node_modules/@excom/heft-rig/scripts/coverage.mjs",
    },
    dependencies: {},
    peerDependencies: {},
    devDependencies: {
      "@excom/heft-rig": "workspace:^",
    },
    keywords: [`${_name}`],
  }),
  "heft-rig": ({ _name }) => ({
    description: `Heft Rig for Monorepo`,
    engines: { node: ">=24.13.0" },
    type: "module",
    scripts: {
      build: `node -e "console.log('${_name}: no build output')`,
      "build:watch": `node -e "console.log('${_name}: no build watch')`,
      format: `node -e "console.log('${_name}: no format')`,
      // The rig tests its own scripts with the vitest runner it ships.
      test: "node scripts/vitest.mjs",
      coverage: "node scripts/coverage.mjs",
    },
    dependencies: {},
    peerDependencies: {},
    devDependencies: {},
    keywords: [],
  }),
  other: ({ _name, engines }) => ({
    description: `Package ${_name}`,
    engines: { ...engines },
    type: undefined,
    scripts: {
      build: `node -e "console.log('${_name}: no build output')`,
      "build:watch": `node -e "console.log('${_name}: no build watch')`,
      format: `node -e "console.log('${_name}: no format')`,
      test: `node -e "console.log('${_name}: no tests')`,
      coverage: `node -e "console.log('${_name}: no coverage')`,
    },
    dependencies: {},
    peerDependencies: {},
    devDependencies: {
      "@excom/heft-rig": "workspace:^",
    },
    keywords: [`${_name}`],
  }),
  tool: ({ _name }) => ({
    description: `${_name} tool`,
    engines: { node: ">=24.13.0" },
    type: "module",
    scripts: {
      build: "node node_modules/@excom/heft-rig/scripts/vite-build.mjs",
      "build:watch":
        "node node_modules/@excom/heft-rig/scripts/vite-build-watch.mjs",
      format: "node node_modules/@excom/heft-rig/scripts/format.mjs",
      test: "node node_modules/@excom/heft-rig/scripts/vitest.mjs",
      coverage: "node node_modules/@excom/heft-rig/scripts/coverage.mjs",
    },
    dependencies: {},
    peerDependencies: {},
    devDependencies: {
      "@excom/heft-rig": "workspace:^",
    },
    keywords: [_name, "tool"],
  }),
  site: ({ _name }) => ({
    description: `${_name} site`,
    engines: { node: ">=24.13.0" },
    type: "module",
    scripts: {
      build: "node node_modules/@excom/heft-rig/scripts/vite-build.mjs",
      "build:watch":
        "node node_modules/@excom/heft-rig/scripts/vite-build-watch.mjs",
      format: "node node_modules/@excom/heft-rig/scripts/format.mjs",
      test: "node node_modules/@excom/heft-rig/scripts/vitest.mjs",
      coverage: "node node_modules/@excom/heft-rig/scripts/coverage.mjs",
      dev: "node node_modules/@excom/heft-rig/scripts/vite-dev.mjs",
      preview: "node node_modules/@excom/heft-rig/scripts/vite-preview.mjs",
    },
    dependencies: {},
    peerDependencies: {},
    devDependencies: {
      "@excom/heft-rig": "workspace:^",
    },
    keywords: [`${_name}`, "site"],
  }),
};

const buildPackageJson = (packageConfig) => {
  const packageType = packageConfig.excom?.packageType;
  if (packageType && !PACKAGE_TYPE_DEFAULTS[packageType]) {
    throw new Error(`Invalid package type: ${packageType}`);
  }
  return PACKAGE_TYPE_DEFAULTS[packageType]
    ? PACKAGE_TYPE_DEFAULTS[packageType](packageConfig)
    : PACKAGE_TYPE_DEFAULTS.other(packageConfig);
};

// should only be run in the CI...
export async function formatPackageJson(packageRoot = process.cwd()) {
  const pkg = JSON.parse(
    await readFile(path.resolve(packageRoot, "package.json"), "utf8"),
  );
  const {
    name,
    version,
    displayName,
    description,
    license,
    engines,
    type,
    scripts,
    dependencies,
    peerDependencies,
    devDependencies,
    repository,
    homepage,
    bugs,
    keywords,
    excom,
    ...rest
  } = pkg;

  if (!name || !version) {
    throw new Error("Package name and version are required");
  }

  let formattedPackageJson;

  if (excom) {
    const _name = name.split("/")[1];

    // rename field
    const isPrivate = pkg.private;
    delete pkg.private;

    const defaults = buildPackageJson({
      _name,
      isPrivate,
      ...pkg,
    });

    formattedPackageJson = {
      name,
      ...(isPrivate ? { private: true } : {}),
      version: version,
      displayName,
      description: description || defaults.description,
      license: license || "MIT",
      engines: sortObjectAlphabetically({
        ...defaults.engines,
        ...(engines || {}),
      }),
      type: type || defaults.type,
      scripts: {
        ...defaults.scripts,
        ...(scripts || {}),
      },
      // A package never depends on itself (a template default such as
      // `@excom/neutron` for `element-base` would make Rush's graph cyclic)
      dependencies: sortObjectAlphabetically(
        Object.fromEntries(
          Object.entries({
            ...defaults.dependencies,
            ...(dependencies || {}),
          }).filter(([dep]) => dep !== name),
        ),
      ),
      peerDependencies: sortObjectAlphabetically({
        ...defaults.peerDependencies,
        ...(peerDependencies || {}),
      }),
      devDependencies: sortObjectAlphabetically({
        ...defaults.devDependencies,
        ...(devDependencies || {}),
      }),
      repository: isPrivate
        ? undefined
        : repository || {
            url: "excom-dev/nucleus",
            directory: `packages/${_name}`,
          },
      homepage: isPrivate
        ? undefined
        : homepage ||
          `https://github.com/excom-dev/nucleus/tree/main/packages/${_name}/support/docs/README.md`,
      bugs: bugs || `https://github.com/excom-dev/nucleus/issues`,
      keywords: uniqueArray([...defaults.keywords, ...(keywords || [])]),
      excom: sortObjectAlphabetically(excom),
      ...sortObjectAlphabetically(rest || {}),
    };
  } else {
    formattedPackageJson = pkg;
  }

  await writeFile(
    path.resolve(packageRoot, "package.json"),
    JSON.stringify(formattedPackageJson, null, 2),
  );
}

async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const resolvedArg = path.resolve(process.cwd(), process.argv[1]);
    const thisFile = fileURLToPath(import.meta.url);
    const [argRealPath, fileRealPath] = await Promise.all([
      realpath(resolvedArg),
      realpath(thisFile),
    ]);
    return argRealPath === fileRealPath;
  } catch {
    return false;
  }
}

if (await isMain()) {
  await formatPackageJson();
}
