When the new issue with tag "Delegated to AI" is created of the label is added to the exisiting issue, do the following:
* Create a branch for the fix with the name pattern delegated-to-ai/<ISSUE_ID>_<NAME>, where <ISSUE_ID> is the issue number, and <NAME> is the short description  
* Implement the fix
* Create a Pull Request with the fix
* Check if it could be merged without any merges
* Check the result of the review automation on the Pull Request
* If nothing severy was found, merge the Pull Request
* If something severe was found, stop here and request the attention of the AI operator