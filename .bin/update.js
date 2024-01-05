const fs = require("node:fs");
const path = require("node:path");
const { exec, execSync } = require("node:child_process");

const MIN_VERSION = "4.4.0";
const REPO_ROOT = path.join(__dirname, "..");
const INSTALL_BATCH_SIZE = 12;
const INSTALL_TIMEOUT = 15000; // ms - Exit install after timeout to skip dependency installation

const listStrapiVersions = ({ minVersion }) => {
  const rawVersions = execSync("npm view create-strapi-app versions", {
    encoding: "utf8",
  });

  git("checkout master");
  const alreadyInstalled = git("branch")
    .trim()
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v !== "* master");

  const versions = JSON.parse(rawVersions.replaceAll("'", '"'));

  console.log(
    `\nSkipping already installed versions: ${alreadyInstalled.join(", ")}\n`
  );

  const firstVersionIndex = versions.findIndex((version) =>
    version.startsWith(minVersion)
  );

  versions.splice(0, firstVersionIndex);

  const selectedVersions = versions.filter(
    (v) => !alreadyInstalled.includes(v)
  );

  return selectedVersions;
};

const installStrapiVersion = async (version, { workdir }) =>
  new Promise((resolve) => {
    console.log(`Installing ${version}`);

    const childProcess = exec(
      `yes | npx create-strapi-app@${version} ${version} --quickstart`,
      {
        cwd: workdir,
        encoding: "utf8",
        timeout: INSTALL_TIMEOUT,
        killSignal: "SIGINT",
      },
      (err, stdout, stderr) => {
        if (fs.existsSync(path.join(workdir, version))) {
          fs.rmSync(path.join(workdir, version, "node_modules"), {
            recursive: true,
            force: true,
          });
          console.log(`Successfully installed ${version}`);
          childProcess.kill("SIGINT");
          resolve();
        } else {
          console.log(`Errors during installation for ${version}`);

          if (process.env.DEBUG) {
            console.error({ err, stdout, stderr });
          }
          childProcess.kill("SIGINT");
          resolve();
        }
      }
    );
  });

const installStrapiVersions = async (versions) => {
  const workdir = path.join(REPO_ROOT, "workdir");

  fs.rmSync(workdir, { recursive: true, force: true });
  fs.mkdirSync(workdir);

  console.log(`Selected for install: ${versions.join(", ")}\n`);

  const batch_count = Math.ceil(versions.length / INSTALL_BATCH_SIZE);
  const batches = [];

  for (let i = 0; i < batch_count; i++) {
    if (i === batch_count - 1) {
      batches.push(versions);
    } else {
      batches.push(versions.splice(0, INSTALL_BATCH_SIZE));
    }
  }

  console.log(
    `Installing ${batch_count} batches`
  );

  for (const batch of batches) {
    const installs = batch.map((version) =>
      installStrapiVersion(version, { workdir })
    );

    await Promise.all(installs);
  }
};

const git = (command) =>
  execSync(`git ${command}`, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

const copyDirectoryContent = (src, dst) => {
  const files = fs.readdirSync(src);

  for (const file of files) {
    fs.cpSync(path.join(src, file), path.join(REPO_ROOT, file), {
      recursive: true,
      filter: (src) => !src.endsWith(".gitignore"),
    });
  }

  console.log(`Copied ${files.length} files to repositort root`);
};

const moveVersionsToBranches = (versions) => {
  console.log("\nMoving each strapi version files to a dedicated git branch");

  for (const version of versions) {
    const strapiPath = path.join(REPO_ROOT, "workdir", version);

    if (!fs.existsSync(strapiPath)) continue;

    console.log(`\n> Creating branch for ${version}`);
    git("checkout master");

    // Delete branch if it already exists
    try {
      git(`branch -D ${version}`);
    } catch (error) {}

    git(`checkout -b ${version}`);
    copyDirectoryContent(strapiPath, REPO_ROOT);
    git("add -A");
    git(`commit -m "Init version ${version}"`);

    fs.rmSync(path.join(strapiPath), {
      recursive: true,
      force: true,
    });
  }
};

const main = async () => {
  const versions = listStrapiVersions({ minVersion: MIN_VERSION });

  await installStrapiVersions(versions);
  moveVersionsToBranches(versions);

  console.log("\nDone.");
  git("checkout master");
};

main();