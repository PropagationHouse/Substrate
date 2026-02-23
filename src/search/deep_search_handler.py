from typing import Dict, Optional
from ..augmented_chat.web_augmented_response import WebAugmentedResponse

class DeepSearchHandler:
    def __init__(self, web_augmentor: WebAugmentedResponse):
        self.web_augmentor = web_augmentor
        self.deep_search_triggers = [
            "explain in detail",
            "tell me more about",
            "i want to learn about",
            "give me details on",
            "research",
            "deep dive",
            "comprehensive",
            "everything about",
            "in depth"
        ]

    def should_deep_search(self, query: str) -> bool:
        """Determine if the query warrants a deep search"""
        query_lower = query.lower()
        return any(trigger in query_lower for trigger in self.deep_search_triggers)

    async def handle_query(self, query: str, initial_response: str, force_search: bool = True) -> Dict:
        """Handle a query with appropriate search depth"""
        depth = "deep" if self.should_deep_search(query) else "basic"
        
        if force_search:
            # In test mode or when search is explicitly requested, always search
            result = await self.web_augmentor.augment_response(
                query=query,
                initial_response="I should check the latest information.",  # Force augmentation
                depth=depth
            )
        else:
            # In normal mode, only search if uncertain
            result = await self.web_augmentor.augment_response(
                query=query,
                initial_response=initial_response,
                depth=depth
            )
        
        return result
