const express = require('express');
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
require('dotenv').config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Telegram Bot
const bot = new Telegraf("5368324838:AAHvB_0kyNfJ-ozs4GygguSX-fVmBlEfMdk");
bot.use(session());

// Set up Express
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Constants
const BASE_URL = 'https://streamed.su/api/matches';
const MATCHES_PER_PAGE = 10;

// Helper function to format date for Bangladesh
const formatBangladeshTime = (timestamp) => {
    const date = new Date(parseInt(timestamp));
    const options = {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    return date.toLocaleString('en-US', options);
};

// Main menu options
const mainMenu = Markup.keyboard([
    ['⚽ Football', '🏏 Cricket']
]).resize();

// Sub menu options
const subMenu = Markup.keyboard([
    ['All', 'Popular', '🔴 Live'],
    ['Back to Main Menu']
]).resize();

// Helper function to create source buttons
const createSourceButtons = (sources) => {
    const publicUrl = "https://2dbb-118-179-115-139.ngrok-free.app"
    const buttons = sources.map((source) => {
        return [Markup.button.url(
            source.source.toUpperCase(),
            `${publicUrl}/stream/${source.source}/${source.id}`
        )];
    });
    buttons.push([Markup.button.callback('🔙 Back to Matches', 'back')]);
    return Markup.inlineKeyboard(buttons);
};

// Helper function to create match buttons with pagination
const createMatchButtons = (matches, currentPage, totalPages) => {
    const startIdx = (currentPage - 1) * MATCHES_PER_PAGE;
    const endIdx = startIdx + MATCHES_PER_PAGE;
    const currentMatches = matches.slice(startIdx, endIdx);

    const matchButtons = currentMatches.map((match, index) => {
        const displayTitle = match.title.length > 35 
            ? match.title.substring(0, 35) + '...' 
            : match.title;
        
        return [Markup.button.callback(
            displayTitle,
            `m${startIdx + index}`
        )];
    });

    const navigationButtons = [];
    if (totalPages > 1) {
        if (currentPage > 1) {
            navigationButtons.push(Markup.button.callback('⬅️', `p${currentPage - 1}`));
        }
        navigationButtons.push(Markup.button.callback(`${currentPage}/${totalPages}`, 'cp'));
        if (currentPage < totalPages) {
            navigationButtons.push(Markup.button.callback('➡️', `p${currentPage + 1}`));
        }
    }

    if (navigationButtons.length > 0) {
        matchButtons.push(navigationButtons);
    }

    return Markup.inlineKeyboard(matchButtons);
};

// Helper function to format match details
const formatMatchDetails = (match) => {
    let message = `🎮 *${match.title}*\n\n`;
    
    if (match.teams) {
        message += `🏠 Home: ${match.teams.home.name}\n`;
        message += `🌍 Away: ${match.teams.away.name}\n\n`;
    }
    
    if (match.date) {
        const formattedDate = formatBangladeshTime(match.date);
        message += `📅 Date: ${formattedDate}\n`;
    }
    
    message += `\n📺 Available Sources: ${match.sources.length}`;
    
    return message;
};

// Helper function to fetch matches
const fetchMatches = async (sport, type = '') => {
    try {
        let url;
        if (type === 'popular') {
            url = `${BASE_URL}/${sport}/popular`;
        } else if (type === 'live') {
            url = `${BASE_URL}/live`;
        } else {
            url = `${BASE_URL}/${sport}`;
        }
        
        const response = await axios.get(url);
        return response.data.filter(match => match.category === sport);
    } catch (error) {
        console.error("Error fetching ${sport} matches:", error);
        return [];
    }
};

// Helper function to display matches page
const displayMatchesPage = async (ctx, matches, page = 1) => {
    const totalPages = Math.ceil(matches.length / MATCHES_PER_PAGE);
    const sport = ctx.session?.sport || 'football';
    const type = ctx.session?.type || 'all';
    
    const messageText = `${type.charAt(0).toUpperCase() + type.slice(1)} ${sport} matches ` +
        `(Page ${page} of ${totalPages}, Total matches: ${matches.length})`;

    ctx.session.matches = matches;
    ctx.session.currentPage = page;
    ctx.session.totalPages = totalPages;

    const markup = createMatchButtons(matches, page, totalPages);

    try {
        if (ctx.callbackQuery) {
            await ctx.editMessageText(messageText, markup);
        } else {
            await ctx.reply(messageText, markup);
        }
    } catch (error) {
        console.error('Error displaying matches:', error);
        if (error.description?.includes('message is not modified')) {
            await ctx.answerCbQuery('No changes to display');
        } else {
            ctx.reply('Error displaying matches. Please try again.');
        }
    }
};

// Bot command handlers
bot.command('start', (ctx) => {
    ctx.session = {
        sport: null,
        type: null,
        matches: [],
        currentPage: 1,
        totalPages: 1
    };
    ctx.reply('Welcome to Sports Streaming Bot! Please select a sport:', mainMenu);
});

bot.hears(['⚽ Football', '🏏 Cricket'], (ctx) => {
    if (!ctx.session) ctx.session = {};
    const sport = ctx.message.text.includes('Football') ? 'football' : 'cricket';
    ctx.session.sport = sport;
    ctx.session.type = null;
    ctx.reply('Choose an option:', subMenu);
});

bot.hears(['All', 'Popular', '🔴 Live'], async (ctx) => {
    if (!ctx.session) ctx.session = {};
    const option = ctx.message.text.toLowerCase();
    const sport = ctx.session?.sport || 'football';
    ctx.session.type = option;
    
    try {
        const matches = await fetchMatches(
            sport,
            option === 'popular' ? 'popular' : option === '🔴 live' ? 'live' : ''
        );
        
        if (matches.length === 0) {
            ctx.reply('No matches available at the moment.');
            return;
        }

        await displayMatchesPage(ctx, matches, 1);
    } catch (error) {
        console.error('Error in sub menu handler:', error);
        ctx.reply('Sorry, there was an error fetching the matches. Please try again later.');
    }
});

// Match selection handler
bot.action(/^m(\d+)$/, async (ctx) => {
    const matchIndex = parseInt(ctx.match[1]);
    const match = ctx.session?.matches[matchIndex];
    
    if (match) {
        try {
            ctx.session.currentMatch = match;
            const message = formatMatchDetails(match);
            const markup = createSourceButtons(match.sources);
            
            if (match.poster) {
                const posterUrl = `https://streamed.su${match.poster}`;
                try {
                    await ctx.replyWithPhoto(
                        posterUrl,
                        {
                            caption: message,
                            parse_mode: 'Markdown',
                            ...markup
                        }
                    );
                } catch (error) {
                    console.error('Error sending poster:', error);
                    await ctx.reply(message, {
                        parse_mode: 'Markdown',
                        ...markup
                    });
                }
            } else {
                await ctx.reply(message, {
                    parse_mode: 'Markdown',
                    ...markup
                });
            }
        } catch (error) {
            console.error('Error displaying match details:', error);
            await ctx.reply('Error displaying match details. Please try again.');
        }
    } else {
        await ctx.reply('Match not found. Please try again.');
    }
    await ctx.answerCbQuery();
});

// Other bot handlers
bot.action(/^p(\d+)$/, async (ctx) => {
    if (!ctx.session) ctx.session = {};
    const newPage = parseInt(ctx.match[1]);
    const matches = ctx.session?.matches || [];
    
    if (matches.length > 0) {
        await displayMatchesPage(ctx, matches, newPage);
    } else {
        ctx.reply('No matches data available. Please select a category again.');
    }
    await ctx.answerCbQuery();
});

bot.action('back', async (ctx) => {
    const matches = ctx.session?.matches || [];
    const currentPage = ctx.session?.currentPage || 1;
    
    if (matches.length > 0) {
        await displayMatchesPage(ctx, matches, currentPage);
    } else {
        ctx.reply('Please select a sport and category again.', mainMenu);
    }
    await ctx.answerCbQuery();
});

bot.action('cp', async (ctx) => {
    await ctx.answerCbQuery();
});

bot.hears('Back to Main Menu', (ctx) => {
    ctx.session = {
        sport: null,
        type: null,
        matches: [],
        currentPage: 1,
        totalPages: 1
    };
    ctx.reply('Please select a sport:', mainMenu);
});

// Express route for handling streams
app.get('/stream/:source/:id', async (req, res) => {
    try {
        const { source, id } = req.params;
        const response = await axios.get(`https://streamed.su/api/stream/${source}/${id}`);
        const streamData = response.data[0];
        console.log(streamData);
        
        if (!streamData) {
            throw new Error('Stream not found');
        }
        
        res.render('stream', { 
            streamData,
            title: 'Stream Player'
        });
        
    } catch (error) {
        console.error('Error fetching stream:', error);
        res.render('error', { 
            message: 'Stream not available',
            error: error.message
        });
    }
});

// Error handler
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('An error occurred. Please try again later.');
});

// Start both Express and Telegram bot
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    bot.launch()
        .then(() => console.log('Bot is running...'))
        .catch(err => console.error('Error starting bot:', err));
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));