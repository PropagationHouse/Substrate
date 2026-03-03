import json
import re
from typing import List, Dict, Optional
from ..search.searx_client import SearchClient

class WebAugmentedResponse:
    def __init__(self, search_client: SearchClient):
        self.search_client = search_client
        self.uncertainty_patterns = [
            r"I'm not sure",
            r"I don't know",
            r"I cannot",
            r"I'm unable to",
            r"I don't have access to",
            r"my knowledge is limited",
            r"my information might be outdated",
            r"I may be mistaken",
            r"I'm not certain",
        ]
        
        # Perplexica-style prompt templates
        self.search_prompts = {
            "general": (
                "Search for factual, up-to-date information about: {query}\n"
                "Focus on reliable sources and recent information."
            ),
            "news": (
                "Find recent news and developments about: {query}\n"
                "Prioritize reputable news sources from the past year."
            ),
            "technical": (
                "Search for technical or scientific information about: {query}\n"
                "Focus on academic sources, documentation, or expert discussions."
            ),
            "comparison": (
                "Find comparative information about: {query}\n"
                "Look for sources that analyze or compare different aspects."
            ),
            "weather": (
                "Find current weather information about: {query}\n"
                "Prioritize weather forecasts and current conditions."
            )
        }
        
    def get_search_prompt(self, query: str) -> str:
        """Get appropriate search prompt based on query type"""
        query_lower = query.lower()
        
        # Add direct answer patterns
        if any(word in query_lower for word in ['weather', 'temperature', 'forecast']):
            return self.search_prompts["weather"].format(query=query)
        # News keyword removed to avoid double-triggering
        elif any(word in query_lower for word in ['recent', 'latest', 'update']):
            return self.search_prompts["news"].format(query=query)
        elif any(word in query_lower for word in ['how', 'technical', 'code', 'implement']):
            return self.search_prompts["technical"].format(query=query)
        elif any(word in query_lower for word in ['compare', 'difference', 'better', 'versus', 'vs']):
            return self.search_prompts["comparison"].format(query=query)
        else:
            return self.search_prompts["general"].format(query=query)

    def should_show_sources(self, query: str) -> bool:
        """Determine if we should show the source links"""
        query_lower = query.lower()
        show_triggers = ['show', 'find', 'search', 'look up', 'source', 'reference', 'link']
        return any(trigger in query_lower for trigger in show_triggers)

    def synthesize_response(self, query: str, results: List[Dict]) -> str:
        """Synthesize a natural language response from search results"""
        query_lower = query.lower()
        
        # Weather-specific synthesis
        if any(word in query_lower for word in ['weather', 'temperature', 'forecast']):
            for result in results:
                if 'weather' in result['title'].lower() or 'forecast' in result['title'].lower():
                    # Extract temperature and conditions from snippet
                    snippet = result['snippet'].lower()
                    temp_match = re.search(r'(\d+)°?f', snippet)
                    temp = temp_match.group(1) if temp_match else None
                    
                    conditions = None
                    weather_terms = ['sunny', 'cloudy', 'rain', 'snow', 'clear', 'storm', 'wind']
                    for term in weather_terms:
                        if term in snippet:
                            conditions = term
                            break
                    
                    if temp or conditions:
                        response = f"Currently in Bellingham, "
                        if temp:
                            response += f"it's {temp}°F"
                        if conditions:
                            response += f" and {conditions}"
                        return response
        
        # Recent information synthesis (news keyword removed)
        elif any(word in query_lower for word in ['recent', 'latest', 'update']):
            if results:
                return f"The latest update is: {results[0]['snippet']}"
        
        # Default synthesis - use the most relevant snippet
        if results:
            return results[0]['snippet']
        
        return "I couldn't find a direct answer to your question."

    def format_web_results(self, web_data: Dict, show_sources: bool = False) -> tuple[str, str]:
        """Format web search results into a readable context and direct answer"""
        if not web_data['results']:
            return "I couldn't find any relevant information.", ""
            
        # Synthesize a direct answer
        direct_answer = self.synthesize_response(web_data['query'], web_data['results'])
        
        # If we don't need to show sources, just return the direct answer
        if not show_sources and not web_data['depth'] == "deep":
            return direct_answer, ""
            
        # Format sources
        sources = []
        if web_data['depth'] == "deep":
            sources.append(f"\nDetailed sources about '{web_data['query']}':")
        else:
            sources.append(f"\nSources:")
        
        for idx, result in enumerate(web_data['results'], 1):
            sources.append(f"{idx}. {result['title']}")
            if web_data['depth'] == "deep":
                sources.append(f"   {result['snippet']}")
            sources.append(f"   Link: {result['url']}")
            sources.append("")  # Empty line between results
            
        return direct_answer, "\n".join(sources)

    def detect_uncertainty(self, response: str) -> bool:
        """Detect if the model's response indicates uncertainty"""
        return any(re.search(pattern, response, re.IGNORECASE) 
                  for pattern in self.uncertainty_patterns)

    async def get_web_context(self, query: str, depth: str = "basic") -> Dict:
        """Get web search results with different depth levels"""
        # Get appropriate search prompt
        search_prompt = self.get_search_prompt(query)
        
        results = []
        if depth == "basic":
            # Quick search with just top 3 results
            results = await self.search_client.search(
                query=query,  # Use raw query for better results
                num_results=3
            )
        else:  # depth == "deep"
            # More comprehensive search across multiple categories
            results = await self.search_client.search(
                query=query,  # Use raw query for better results
                num_results=5
            )
            
            # Add specialized searches based on query type
            if any(word in query.lower() for word in ['when', 'date', 'year', 'time']):
                # News-specific search removed to avoid double-triggering
                time_results = await self.search_client.search(
                    query=f"latest information about {query}",
                    num_results=2
                )
                results.extend(time_results)
                
        return {
            'query': query,
            'search_prompt': search_prompt,
            'depth': depth,
            'results': results
        }

    async def augment_response(self, 
                             query: str, 
                             initial_response: str,
                             depth: str = "basic") -> Dict:
        """Augment the model's response with web search results if needed"""
        needs_augmentation = self.detect_uncertainty(initial_response)
        show_sources = self.should_show_sources(query)
        
        response_data = {
            'original_response': initial_response,
            'augmented': False,
            'web_context': None,
            'search_prompt': None,
            'final_response': initial_response
        }
        
        if needs_augmentation or show_sources:
            # Get web context
            web_data = await self.get_web_context(query, depth)
            
            # Always try to synthesize a direct answer
            direct_answer = self.synthesize_response(web_data['query'], web_data['results'])
            
            # Format sources if needed
            sources = ""
            if show_sources or depth == "deep":
                sources = []
                if depth == "deep":
                    sources.append(f"\nDetailed sources about '{web_data['query']}':")
                else:
                    sources.append(f"\nSources:")
                
                for idx, result in enumerate(web_data['results'], 1):
                    sources.append(f"{idx}. {result['title']}")
                    if depth == "deep":
                        sources.append(f"   {result['snippet']}")
                    sources.append(f"   Link: {result['url']}")
                    sources.append("")  # Empty line between results
                sources = "\n".join(sources)
            
            # Construct the final response
            final_response = direct_answer
            if sources:
                final_response += f"\n\n{sources}"
            
            response_data.update({
                'augmented': True,
                'web_context': sources if sources else direct_answer,
                'search_prompt': web_data['search_prompt'],
                'final_response': final_response
            })
            
        return response_data
