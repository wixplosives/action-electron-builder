const { execSync } = require("child_process");
const { existsSync, readFileSync } = require("fs");
const { join } = require("path");
var fsExtra = require('fs-extra');
/**
 * Logs to the console
 */
const log = (msg) => console.log(`\n${msg}`); // eslint-disable-line no-console

/**
 * Exits the current process with an error code and message
 */
const exit = (msg) => {
	console.error(msg);
	process.exit(1);
};

/**
 * Executes the provided shell command and redirects stdout/stderr to the console
 */
const run = (cmd, cwd) => execSync(cmd, { encoding: "utf8", stdio: "inherit", cwd });

/**
 * Determines the current operating system (one of ["mac", "windows", "linux"])
 */
const getPlatform = () => {
	switch (process.platform) {
		case "darwin":
			return "mac";
		case "win32":
			return "windows";
		default:
			return "linux";
	}
};

/**
 * Returns the value for an environment variable (or `null` if it's not defined)
 */
const getEnv = (name) => process.env[name.toUpperCase()] || null;

/**
 * Sets the specified env variable if the value isn't empty
 */
const setEnv = (name, value) => {
	if (value) {
		process.env[name.toUpperCase()] = value.toString();
	}
};

/**
 * Returns the value for an input variable (or `null` if it's not defined). If the variable is
 * required and doesn't have a value, abort the action
 */
const getInput = (name, required) => {
	const value = getEnv(`INPUT_${name}`);
	if (required && !value) {
		exit(`"${name}" input variable is not defined`);
	}
	return value;
};

function getFilesFromPath(path, extension) {
    let files = fs.readdirSync( path );
    return files.filter( file => file.match(new RegExp(`.*\.(${extension})`, 'ig')));
}



/**
 * Installs NPM dependencies and builds/releases the Electron app
 */
const runAction = () => {
	const platform = getPlatform();
	const publishCmd = getInput("publish_cmd") || "electron-builder";
	const release = getInput("release") === "true";
	const pkgRoot = getInput("package_root", true);
	const buildScriptName = getInput("build_script_name", "build");
	const skipBuild = getInput("skip_build") === "true";
	const skipBuild = getInput("skip_deps") === "true";
	const publishToFolder = getInput("publish_to_folder") === "true";
	const publishingFolder = getInput("publishing_folder","upload_folder") ;
	const args = getInput("args") || "";
	const maxAttempts = Number(getInput("max_attempts") || "1");

	// TODO: Deprecated option, remove in v2.0. `electron-builder` always requires a `package.json` in
	// the same directory as the Electron app, so the `package_root` option should be used instead
	const appRoot = getInput("app_root") || pkgRoot;

	const pkgJsonPath = join(pkgRoot, "package.json");
	const pkgLockPath = join(pkgRoot, "package-lock.json");

	// Determine whether NPM should be used to run commands (instead of Yarn, which is the default)
	const useNpm = existsSync(pkgLockPath);
	log(`Will run ${useNpm ? "NPM" : "Yarn"} commands in directory "${pkgRoot}"`);

	// Make sure `package.json` file exists
	if (!existsSync(pkgJsonPath)) {
		exit(`\`package.json\` file not found at path "${pkgJsonPath}"`);
	}

	// Copy "github_token" input variable to "GH_TOKEN" env variable (required by `electron-builder`)
	setEnv("GH_TOKEN", getInput("github_token", true));

	// Require code signing certificate and password if building for macOS. Export them to environment
	// variables (required by `electron-builder`)
	if (platform === "mac") {
		setEnv("CSC_LINK", getInput("mac_certs"));
		setEnv("CSC_KEY_PASSWORD", getInput("mac_certs_password"));
	} else if (platform === "windows") {
		setEnv("CSC_LINK", getInput("windows_certs"));
		setEnv("CSC_KEY_PASSWORD", getInput("windows_certs_password"));
	}

	// Disable console advertisements during install phase
	setEnv("ADBLOCK", true);
	if (skip_deps) {
		log("Skipping installing deps script because `skip_deps` option is set");
	}else{
		log(`Installing dependencies using ${useNpm ? "NPM" : "Yarn"}…`);
		run(useNpm ? "npm install" : "yarn", pkgRoot);
	}

	// Run NPM build script if it exists
	if (skipBuild) {
		log("Skipping build script because `skip_build` option is set");
	} else {
		log("Running the build script…");
		if (useNpm) {
			run(`npm run ${buildScriptName} --if-present`, pkgRoot);
		} else {
			// TODO: Use `yarn run ${buildScriptName} --if-present` once supported
			// https://github.com/yarnpkg/yarn/issues/6894
			const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
			if (pkgJson.scripts && pkgJson.scripts[buildScriptName]) {
				run(`yarn run ${buildScriptName}`, pkgRoot);
			}
		}
	}

	log(`Building${release ? " and releasing" : ""} the Electron app…`);
	const cmd =  publishCmd;
	for (let i = 0; i < maxAttempts; i += 1) {
		try {
			run(
				`${useNpm ? "npx --no-install" : "yarn run"} ${cmd} --${platform} ${
					release ? "--publish always" : ""
				} ${args}`,
				appRoot,
			);
			break;
		} catch (err) {
			if (i < maxAttempts - 1) {
				log(`Attempt ${i + 1} failed:`);
				log(err);
			} else {
				throw err;
			}
		}
	}
	if (publish_to_folder){
		var extension = ""
		if (platform=="mac"){
			extension = ".dmg"
		}else if (platform=="linux"){
			extension = ".deb"
		}else if (platform=="windows"){
			extension = ".exe"
		}		
		const files = getFilesFromPath("./build", extension);
		core.setOutput("resultFileName", files[0]);
		files.forEach(function (item, index) {
			fsExtra.copySync(path.resolve("build", file), path.resolve(publishingFolder, file));
		});		
	}
};

runAction();
