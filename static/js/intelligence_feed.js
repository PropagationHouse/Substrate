document.addEventListener('DOMContentLoaded', () => {
    const feedList = document.getElementById('feed-list');
    if (!feedList) return;

    // Hardcoded feed items for demonstration
    const feedItems = [
        {
            title: 'NVIDIA Unveils New AI Chip at GTC 2026',
            link: 'https://example.com/nvidia-ai-chip',
            date: '2026-03-10'
        },
        {
            title: 'Apple Launches Budget MacBook Neo',
            link: 'https://example.com/macbook-neo',
            date: '2026-03-10'
        },
        {
            title: 'China\'s Exports Surge 20% in Early 2026',
            link: 'https://example.com/china-trade-surge',
            date: '2026-03-10'
        },
        {
            title: 'US Military Strikes Iran Targets Amid Rising Tensions',
            link: 'https://example.com/us-iran-tensions',
            date: '2026-03-10'
        }
    ];

    feedList.innerHTML = ''; // Clear "Loading feed..."

    feedItems.forEach(item => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            <a href="${item.link}" target="_blank">${item.title}</a>
            <span class="date">${item.date}</span>
        `;
        feedList.appendChild(listItem);
    });
});