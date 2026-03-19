document.addEventListener('DOMContentLoaded', () => {
    const marketPulseGraphCtx = document.getElementById('market-pulse-graph')?.getContext('2d');
    const featuredArticlesSection = document.getElementById('featured-articles');

    if (marketPulseGraphCtx) {
        fetch('workspace/output/market_data.json')
            .then(response => response.json())
            .then(data => {
                const datasets = [];
                const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40']; // Chart.js default colors

                let i = 0;
                for (const ticker in data) {
                    if (data.hasOwnProperty(ticker)) {
                        datasets.push({
                            label: ticker,
                            data: data[ticker].prices,
                            borderColor: colors[i % colors.length],
                            fill: false
                        });
                        i++;
                    }
                }

                new Chart(marketPulseGraphCtx, {
                    type: 'line',
                    data: {
                        labels: data[Object.keys(data)[0]].dates, // Use dates from the first ticker
                        datasets: datasets
                    },
                    options: {
                        responsive: true,
                        scales: {
                            x: {
                                type: 'time', // Assuming dates are in a format Chart.js can parse
                                time: {
                                    unit: 'day'
                                },
                                title: {
                                    display: true,
                                    text: 'Date'
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'Price'
                                }
                            }
                        }
                    }
                });
            })
            .catch(error => console.error('Error fetching market data:', error));
    }

    // Populate Featured Articles
    if (featuredArticlesSection) {
        const articles = [
            {
                title: 'Tech Giants Unveil Q1 Earnings',
                image: 'https://via.placeholder.com/150',
                content: 'Major technology companies have announced their first-quarter earnings, with mixed results across the board. Apple reported strong iPhone sales, while NVIDIA saw a dip in gaming GPU revenue but a surge in data center AI chips. This detailed analysis covers the financial performance, market reactions, and future outlook for the leading technology companies in the first quarter.'
            },
            {
                title: 'Global Markets React to Fed Rate Hike',
                image: 'https://via.placeholder.com/150',
                content: 'The Federal Reserve\'s unexpected rate hike has sent ripples through global markets, causing volatility in stock exchanges worldwide. Investors are closely watching for further policy changes and their potential impact on economic stability. This article provides an in-depth look at the central bank\'s decision, expert opinions, and potential scenarios for the global economy.'
            },
            {
                title: 'AI Breakthroughs Continue to Dominate News',
                image: 'https://via.placeholder.com/150',
                content: 'New advancements in artificial intelligence are being announced almost daily, with significant progress in natural language processing and computer vision. The implications for various industries are profound, promising transformative changes in healthcare, finance, and manufacturing. Read on for a comprehensive overview of the latest AI innovations, their ethical considerations, and their potential to reshape our future.'
            }
        ];

        articles.forEach(article => {
            const articleElement = document.createElement('div');
            articleElement.classList.add('article-item');
            articleElement.innerHTML = `
                <img src="${article.image}" alt="${article.title}">
                <h3>${article.title}</h3>
            `;
            articleElement.addEventListener('click', () => {
                document.getElementById('article-modal-title').innerText = article.title;
                document.getElementById('article-modal-content').innerText = article.content;
                document.getElementById('article-modal').style.display = 'block';
            });
            featuredArticlesSection.appendChild(articleElement);
        });

        const modal = document.getElementById('article-modal');
        const closeButton = document.querySelector('.close-button');

        if (closeButton) {
            closeButton.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }

        window.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    if (featuredArticlesSection) {
        const articles = [
            {
                title: 'Tech Giants Unveil Q1 Earnings',
                image: 'https://via.placeholder.com/150',
                content: 'Major technology companies have announced their first-quarter earnings, with mixed results across the board. Apple reported strong iPhone sales, while NVIDIA saw a dip in gaming GPU revenue but a surge in data center AI chips. This detailed analysis covers the financial performance, market reactions, and future outlook for the leading technology companies in the first quarter.'
            },
            {
                title: 'Global Markets React to Fed Rate Hike',
                image: 'https://via.placeholder.com/150',
                content: 'The Federal Reserve's unexpected rate hike has sent ripples through global markets, causing volatility in stock exchanges worldwide. Investors are closely watching for further policy changes and their potential impact on economic stability. This article provides an in-depth look at the central bank's decision, expert opinions, and potential scenarios for the global economy.'
            },
            {
                title: 'AI Breakthroughs Continue to Dominate News',
                image: 'https://via.placeholder.com/150',
                content: 'New advancements in artificial intelligence are being announced almost daily, with significant progress in natural language processing and computer vision. The implications for various industries are profound, promising transformative changes in healthcare, finance, and manufacturing. Read on for a comprehensive overview of the latest AI innovations and their potential to reshape our world.'
            }
        ];

        articles.forEach(article => {
            const articleElement = document.createElement('div');
            articleElement.classList.add('article-item');
            articleElement.innerHTML = `
                <h3>${article.title}</h3>
                <img src="${article.image}" alt="${article.title}">
                <p>${article.content.substring(0, 100)}...</p>
            `;
            articleElement.addEventListener('click', () => {
                document.getElementById('modal-article-title').textContent = article.title;
                document.getElementById('modal-article-image').src = article.image;
                document.getElementById('modal-article-content').textContent = article.content;
                document.getElementById('article-modal').style.display = 'block';
            });
            featuredArticlesSection.appendChild(articleElement);
        });

        // Close modal when close button is clicked
        document.querySelector('.close-button').addEventListener('click', () => {
            document.getElementById('article-modal').style.display = 'none';
        });

        // Close modal when clicking outside of it
        window.addEventListener('click', (event) => {
            const modal = document.getElementById('article-modal');
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
});