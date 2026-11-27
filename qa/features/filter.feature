Feature: Filtering the skills
  The filter field above the results, after the organization JetBrains is scanned.

  Background:
    Given I open the page
    And I type "JetBrains" into the repository field
    And I press Scan

  Scenario: An empty filter shows every skill
    When I type "koog" into the filter field
    And I clear the filter field
    Then 10 skills are shown
    And the filter note is hidden
    And the repositories shown are "JetBrains/koog, JetBrains/kotlin, JetBrains/MPS"
    And the page matches the screenshot "filter-empty"

  Scenario: An existing name shows only its skill
    When I type "mps-build" into the filter field
    Then the skills shown are "mps-build"
    And the filter note reads "1 of 10 skills match"
    And the repositories shown are "JetBrains/MPS"
    And the page matches the screenshot "filter-existing-name"

  Scenario: A name that does not exist shows no skills
    When I type "no-such-skill" into the filter field
    Then no skills are shown
    And the filter note reads "No skills match “no-such-skill”."
    And no repositories are shown
    And the page matches the screenshot "filter-non-existing-name"
