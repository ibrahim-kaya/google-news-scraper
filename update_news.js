const axios = require('axios');
const xml2js = require('xml2js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const cheerio = require('cheerio');

async function fetchRSSLinks(rssUrl) {
    const response = await axios.get(rssUrl);
    const xml = response.data;

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);

    return result.rss.channel[0].item || [];
}

async function gotoWithFullRedirects(page, url, timeout = 60000) {
    let currentUrl = url;
    const start = Date.now();

    try {
        while (true) {
            await page.goto(currentUrl, {waitUntil: 'networkidle2', timeout});

            const newUrl = page.url();

            if (newUrl === currentUrl) {
                return newUrl;
            }

            currentUrl = newUrl;

            if (Date.now() - start > timeout) {
                throw new Error('Yönlendirme timeout oldu');
            }
        }
    } catch (error) {
        console.error(`Hata: ${currentUrl} => ${error.message}`);
        return null; // Hata durumunda null döndür
    }
}

async function getOGImage(url) {
    try {
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const ogImage = $('meta[property="og:image"]').attr('content');

        return ogImage || null;
    } catch (error) {
        console.error('Sayfa okunamadı:', error.message);
        return null;
    }
}

async function main(rssUrl, outputFile) {
    const links = await fetchRSSLinks(rssUrl);

    // Var olan JSON dosyasını oku
    let existingResults = [];
    if (fs.existsSync(outputFile)) {
        const rawData = fs.readFileSync(outputFile, 'utf-8');
        existingResults = JSON.parse(rawData);
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    for (const link of links) {

        // Eğer link zaten var ise atla
        if (existingResults.some(r => r.google_link === link.link[0])) {
            continue;
        }

        console.log('İşleniyor:', link.link[0]);
        const finalUrl = await gotoWithFullRedirects(page, link.link[0]);

        // Eğer finalUrl null ise atla
        if (!finalUrl) {
            console.warn(`Final URL bulunamadı: ${link}`);
            continue;
        }

        const resultEntry = {
            title: link.title[0],
            link: finalUrl,
            google_link: link.link[0],
            // description: link.description[0],
            source_name: link.source[0]._,
            source_url: link.source[0].$.url,
        };

        // Eğer zaten var ise güncelle, yoksa ekle
        const index = existingResults.findIndex(r => r.link === resultEntry.link);
        if (index >= 0) {
            existingResults[index] = resultEntry;
        } else {
            existingResults.push(resultEntry);
        }

        // Dosyayı her link sonrası güncellemek istersen buraya yazabilirsin
        // fs.writeFileSync(outputFile, JSON.stringify(existingResults, null, 2), 'utf-8');
    }
    await browser.close();

    // Son olarak Open Graph resimlerini al
    for (const result of existingResults) {
        // Eğer Open Graph resmi zaten varsa ve null değilse atla
        if (result.og_image) {
            continue;
        }
        if (!result.og_image) {
            result.og_image = await getOGImage(result.link);
            console.log(`Open Graph resim alındı: ${result.og_image}`);
        }
    }

    // Son hali dosyaya yaz
    fs.writeFileSync(outputFile, JSON.stringify(existingResults, null, 2), 'utf-8');
    console.log(`İşlem tamamlandı. Sonuçlar '${outputFile}' dosyasına kaydedildi.`);
}


const rssFeedUrl = 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNREZ0ZHpFU0FuUnlLQUFQAQ?hl=tr&gl=TR&ceid=TR:tr';  // Buraya feed URL'i yaz
const outputJsonFile = 'results.json';

main(rssFeedUrl, outputJsonFile).catch(console.error);
