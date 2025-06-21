import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import {
	nodePolyfills,
	type PolyfillOptions,
} from "vite-plugin-node-polyfills";
import commonjs from "@rollup/plugin-commonjs";

const nodePolyfillsFix = (options?: PolyfillOptions | undefined): Plugin => {
	return {
		...nodePolyfills(options),
		resolveId(source: string) {
			const m =
				/^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(
					source
				);
			if (m) {
				return `node_modules/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.cjs`;
			}
		},
	};
};

function fixPinoImports(): Plugin {
	return {
		name: "fix-pino-imports",
		transform(code, id) {
			// Transform pino named imports to work with browser build
			if (code.includes("import { pino } from 'pino'")) {
				return code.replace(
					/import\s*{\s*pino\s*}\s*from\s*['"]pino['"]/g,
					"import pino from 'pino'"
				);
			}
			return null;
		},
	};
}

export default defineConfig({
	plugins: [
		// nodePolyfillsFix({ protocolImports: true }),
		nodePolyfillsFix({ include: ["buffer", "path", "process"] }),
		// commonjs({
		// 	include: [/pino/, /node_modules/],
		// 	defaultIsModuleExports: true,
		// }),
		fixPinoImports(),
	].filter(Boolean),
	resolve: {
		alias: {
			src: path.resolve(__dirname, "src"),
			// Force pino to use browser build
			// pino: path.resolve(
			// 	__dirname,
			// 	"../../node_modules/.pnpm/pino@9.7.0/node_modules/pino/browser.js"
			// ),
		},
		conditions: ["browser", "module", "import", "default"],
	},
	base: "/",
	server: {
		port: 3000,
	},
	define: {
		"import.meta.env.PINO_BROWSER": "true",
	},
	optimizeDeps: {
		// Vite has issues in dev mode with .wasm and worker files
		// https://github.com/vitejs/vite/issues/11672
		// https://github.com/vitejs/vite/issues/15618
		// https://github.com/vitejs/vite/issues/15618
		// These dependencies have to also be included in devDependencies for this to work!
		exclude: ["@aztec/bb.js", "@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
		// include: ["pino", "pino/browser"],
		esbuildOptions: {
			// Force pino to be treated as CommonJS and transform to ES6
			mainFields: ["main", "module"],
		},
	},
	build: {
		commonjsOptions: {
			transformMixedEsModules: true,
			// include: [/pino/, /node_modules/],
			// namedExports: {
			// 	pino: ["pino", "default"],
			// 	"pino/browser": ["pino", "default"],
			// },
			defaultIsModuleExports: true,
		},
	},
});
