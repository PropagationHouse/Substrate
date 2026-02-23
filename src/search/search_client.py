import aiohttp
import json
from typing import List, Dict, Optional

class SearchClient:
    def __init__(self):
        self.api_key = 'AIzaSyA4yp06k5NAJ78s-Fiz7tcCWhlE9Va1QsQ'
        self.cx = 'e564a942a48974e52'
        self.base_url = 'https://www.googleapis.com/customsearch/v1'
        
    async def search(self, 
                    query: str, 
                    num_results: int = 5,
                    categories: List[str] = None,  # Not used with Google Search
                    time_range: Optional[str] = None) -> List[Dict]:
        """
        Perform a search using Google Custom Search API
        
        Args:
            query: Search query string
            num_results: Number of results to return (max 10)
            categories: Not used with Google Search
            time_range: Not used with Google Search
            
        Returns:
            List of search results, each containing title, snippet, and url
        """
        params = {
            'key': self.api_key,
            'cx': self.cx,
            'q': query,
            'num': min(num_results, 10)  # Google CSE has a max of 10 results per query
        }
            
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.base_url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        return [
                            {
                                'title': item.get('title', ''),
                                'snippet': item.get('snippet', ''),
                                'url': item.get('link', ''),
                                'source': 'google',
                                'score': idx + 1  # Simple ranking based on position
                            }
                            for idx, item in enumerate(data.get('items', []))
                        ]
                    else:
                        print(f"Search error: {response.status}")
                        return []
        except Exception as e:
            print(f"Search error: {str(e)}")
            return []
