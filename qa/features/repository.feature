Feature: Scanning a repository by its name
  A name typed into the repository field, then Scan.

  Background:
    Given I open the page

  Scenario: A partial name, the owner alone, scans the organization
    When I type "JetBrains" into the repository field
    And I press Scan
    Then the status reads "JetBrains · 3 repositories · 10 skills"
    And the repositories shown are "JetBrains/koog, JetBrains/kotlin, JetBrains/MPS"
    And 10 skills are shown
    And the page matches the screenshot "partial-name-owner"

  Scenario: A partial repository name is not completed to a repository
    When I type "JetBrains/kot" into the repository field
    And I press Scan
    Then the status shows the error "not recorded: https://api.github.com/repos/JetBrains/kot"
    And no skills are shown
    And the page matches the screenshot "partial-name-repository"

  Scenario: An existing repository
    When I type "JetBrains/kotlin" into the repository field
    And I press Scan
    Then the status reads "JetBrains/kotlin · 5 skills"
    And the skills shown are "build-tools-bump-gradle-api, compiler-test-data, gradle-plugin-tests, release-notes, stdlib-api-review"
    And the address has "?repo=JetBrains%2Fkotlin"
    And the page matches the screenshot "existing-repository"

  Scenario: A repository that does not exist
    When I type "JetBrains/elsewhere" into the repository field
    And I press Scan
    Then the status shows the error "not recorded: https://api.github.com/repos/JetBrains/elsewhere"
    And no skills are shown
    And the filter field is hidden
    And the page matches the screenshot "non-existing-repository"
