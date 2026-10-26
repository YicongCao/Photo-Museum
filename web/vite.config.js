import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({build:{rolldownOptions:{input:{
 main:fileURLToPath(new URL('./index.html',import.meta.url)),
 loadingPreview:fileURLToPath(new URL('./brand/loading-preview.html',import.meta.url))
}}}});
