import {
	defineMisskeyDevOxlintConfig,
	oxlintJsRules,
	oxlintStylisticRules,
} from '@misskey-dev/oxlint-fmt-config';

export default defineMisskeyDevOxlintConfig({
	overrides: {
		ignorePatterns: ['**/dist/**', 'nsfw-model/**'],
		overrides: [
			{
				// 共通設定の JS 向けルールは *.js / *.jsx のみが対象のため、ESM / CJS スクリプトにも適用する。
				files: ['**/*.mjs', '**/*.cjs'],
				rules: {
					...oxlintJsRules,
					...oxlintStylisticRules,
				},
			},
			{
				// 設定ファイルはツール側の規約で default export が必須。
				files: ['**/*.config.ts', 'config.*.mjs'],
				rules: {
					'import/no-default-export': 'off',
				},
			},
		],
	},
});
