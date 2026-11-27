Feature: Loading the page
  The web view over the mock data, with no repository chosen yet.

  Scenario: Loading without any repository selected
    When I open the page
    Then the repository field is empty
    And the status reads "Enter a repository or an organization and press Scan."
    And no skills are shown
    And the filter field is hidden
    And the page matches the screenshot "loading-no-repository"
